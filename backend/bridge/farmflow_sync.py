"""
farmflow_sync.py — Time-clock → farm-flow bridge
=================================================
קורא נוכחות משעון ZKTeco (פרוטוקול ZK, פורט 4370) — קריאה לא-הרסנית, במקביל ל-JB Clock —
מחשב לכל עובד לכל יום: החתמה ראשונה/אחרונה + שעות עבודה, ושולח ל-farm-flow.

מקור: השעון (pyzk). אם השעון לא נגיש — קריאה מקובץ ה-WRK החודשי (m{yy}{mm}.wrk).
שולח POST ל-{api_url}/api/attendance/sync עם כותרת x-api-key.

הרצה:
    python farmflow_sync.py                 # מסנכרן את החודש הנוכחי
    python farmflow_sync.py --month 2026-05 # מסנכרן חודש מסוים (backfill)
    python farmflow_sync.py --dry-run       # מחשב ומדפיס בלי לשלוח

תלויות:  pip install pyzk requests
הגדרות:  config.json (בלוק "clock" + בלוק "farmflow")
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime, date

import requests

BASE = Path(getattr(sys, "frozen", False) and sys.executable or __file__).parent
CONFIG_PATH = BASE / "config.json"

# סוגי החתמה (כאשר השעון/WRK מספקים סוג): כניסה מול יציאה
TYPE_IN  = {"B", "I", "0"}   # Begin / In / check-in
TYPE_OUT = {"D", "O", "E", "1"}  # Departure / Out / Exit / check-out


DEFAULT_CONFIG = {
    "clock": {"ip": "192.168.1.166", "port": 4370, "password": 0, "timeout": 10, "wrk_folder": r"C:\jbclock"},
    "farmflow": {"api_url": "https://farm.nitur-ai.com", "api_key": "", "farm_id": ""},
    "ui": {"auto_sync": False, "interval_min": 30},
}


def load_config() -> dict:
    """טוען config.json; אם אינו קיים מחזיר ברירת מחדל (ה-UI יציע לשמור)."""
    if not CONFIG_PATH.exists():
        return json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    # מיזוג מפתחות חסרים מברירת המחדל
    for section, defaults in DEFAULT_CONFIG.items():
        cfg.setdefault(section, {})
        for k, v in defaults.items():
            cfg[section].setdefault(k, v)
    return cfg


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# ─── קריאה מהשעון (pyzk) ──────────────────────────────────────────────────────
def read_clock(clock_cfg: dict, ym: str):
    """מחזיר (users, punches) לחודש ym='YYYY-MM'.
    users  = {uid: name}
    punches = {(uid, 'YYYY-MM-DD'): [(datetime, type_str), ...]}
    קריאה לא-הרסנית — לא מוחק רשומות מהשעון.
    """
    from zk import ZK
    zk = ZK(
        clock_cfg["ip"],
        port=int(clock_cfg.get("port", 4370)),
        timeout=int(clock_cfg.get("timeout", 30)),
        password=int(clock_cfg.get("password", 0)),
        force_udp=False,
        ommit_ping=False,
    )
    conn = None
    users, punches = {}, defaultdict(list)
    try:
        conn = zk.connect()
        conn.disable_device()
        for u in conn.get_users():
            uid = str(u.user_id).lstrip("0") or "0"
            users[uid] = u.name or ""
        for att in conn.get_attendance():
            ts = att.timestamp
            if ts.strftime("%Y-%m") != ym:
                continue
            uid = str(att.user_id).lstrip("0") or "0"
            # punch: 0=check-in, 1=check-out על רוב המכשירים; לא תמיד אמין
            ptype = "0" if getattr(att, "punch", None) == 0 else ("1" if getattr(att, "punch", None) == 1 else "")
            punches[(uid, ts.strftime("%Y-%m-%d"))].append((ts, ptype))
        conn.enable_device()
    finally:
        if conn:
            conn.disconnect()
    return users, punches


# ─── קריאה מקובץ WRK (גיבוי) ─────────────────────────────────────────────────
def read_wrk(clock_cfg: dict, ym: str):
    """גיבוי: קורא את m{yy}{mm}.wrk. מחזיר ({}, punches) — שמות יילקחו מהרשם בשרת."""
    y, m = ym.split("-")
    yy, mm = y[2:], m
    wrk_path = Path(clock_cfg.get("wrk_folder", r"C:\JBCLOCK")) / f"m{yy}{mm}.wrk"
    punches = defaultdict(list)
    if not wrk_path.exists():
        return {}, punches
    with open(wrk_path, encoding="ascii", errors="replace") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if len(line) < 30:
                continue
            if line[17:19] != mm or line[20:22] != yy:
                continue
            uid = line[0:9].lstrip("0") or "0"
            day = int(line[9:16])              # יום בחודש (zfill7)
            hhmm = line[22:29][3:]             # 000HHMM → HHMM
            raw_type = line[29].upper() if len(line) > 29 else ""
            try:
                ts = datetime(int(y), int(mm), day, int(hhmm[:2]), int(hhmm[2:]))
            except ValueError:
                continue
            ptype = "0" if raw_type in TYPE_IN else ("1" if raw_type in TYPE_OUT else "")
            punches[(uid, ts.strftime("%Y-%m-%d"))].append((ts, ptype))
    return {}, punches


# ─── חישוב שעות ────────────────────────────────────────────────────────────────
def build_records(punches: dict, names: dict):
    """ממיר punches לרשומות per-worker-per-day עם זיווג כניסה/יציאה.
    זיווג: אם יש סוגים אמינים (גם 0 וגם 1 ביום) — לפי הסוג; אחרת כרונולוגי (זוגות).
    """
    records = []
    for (uid, day), evs in punches.items():
        evs = sorted(evs, key=lambda x: x[0])
        times = [t for t, _ in evs]
        types = [p for _, p in evs]

        pairs = []
        complete = True
        if "0" in types and "1" in types:
            # זיווג לפי סוג: כל '0' נסגר ב-'1' הבא
            open_in = None
            for t, p in evs:
                if p == "0":
                    open_in = t
                elif p == "1" and open_in is not None:
                    pairs.append((open_in, t)); open_in = None
            if open_in is not None:
                complete = False
        else:
            # זיווג כרונולוגי: (1,2),(3,4)...
            for i in range(0, len(times) - 1, 2):
                pairs.append((times[i], times[i + 1]))
            if len(times) % 2 == 1:
                complete = False

        hours = round(sum((b - a).total_seconds() for a, b in pairs) / 3600.0, 2)
        records.append({
            "time_clock_id": uid,
            "name": names.get(uid, ""),
            "date": day,
            "first_in": times[0].strftime("%H:%M") if times else None,
            "last_out": times[-1].strftime("%H:%M") if len(times) > 1 else None,
            "hours": hours,
            "punches": [{"t": t.strftime("%H:%M"), "type": p} for t, p in evs],
            "complete": complete and len(times) >= 2,
        })
    return records


def test_clock(cfg: dict, log=print) -> dict:
    """בודק חיבור לשעון ומחזיר {ok, users, sample}. משמש את ה-UI."""
    ym = date.today().strftime("%Y-%m")
    names, punches = read_clock(cfg["clock"], ym)
    n_punch = sum(len(v) for v in punches.values())
    log(f"✓ חיבור לשעון תקין: {len(names)} עובדים רשומים, {n_punch} החתמות החודש")
    sample = list(names.items())[:5]
    for uid, nm in sample:
        log(f"    {uid}: {nm}")
    return {"ok": True, "users": len(names), "sample": sample}


def sync_once(cfg: dict, ym: str = None, dry_run: bool = False, log=print) -> dict:
    """לוגיקת הסנכרון המרכזית — משותפת ל-CLI ול-UI.
    מחזיר dict עם {records, total_hours, sent, response/preview}.
    log: callback למחרוזות התקדמות.
    """
    ff = cfg.get("farmflow", {})
    if not dry_run:
        for k in ("api_url", "api_key", "farm_id"):
            if not ff.get(k):
                raise ValueError(f"חסר farmflow.{k} בהגדרות (קבל מ-farm-flow → הגדרות → שעון נוכחות)")

    ym = ym or date.today().strftime("%Y-%m")
    log(f"מסנכרן חודש {ym} ...")

    # 1. נוכחות: WRK הוא המקור הסמכותי לחודש (JB מנקה את המכשיר תקופתית);
    #    השעון מספק שמות עובדים ומשלים ימים שעדיין לא נכתבו ל-WRK (בעיקר היום).
    names, clock_punches = {}, {}
    try:
        names, clock_punches = read_clock(cfg["clock"], ym)
        log(f"  שעון: {len(names)} עובדים, {sum(len(v) for v in clock_punches.values())} החתמות (אחרונות)")
    except Exception as e:
        log(f"  השעון לא נגיש ({e}) — ממשיך עם WRK בלבד")

    _, wrk_punches = read_wrk(cfg["clock"], ym)
    log(f"  WRK: {sum(len(v) for v in wrk_punches.values())} החתמות (סמכותי)")

    wrk_dates = {day for (_uid, day) in wrk_punches}
    punches = dict(wrk_punches)
    added = 0
    for key, evs in clock_punches.items():
        _uid, day = key
        if day not in wrk_dates:
            punches[key] = evs
            added += len(evs)
    if added:
        log(f"  הושלמו {added} החתמות מהשעון לימים שטרם בקובץ ה-WRK")

    records = build_records(punches, names)
    total = round(sum(r["hours"] for r in records), 2)
    log(f"  חושבו {len(records)} רשומות יום-עובד · סה\"כ {total} שעות")

    payload = {
        "farm_id": ff.get("farm_id"),
        "as_of": datetime.now().isoformat(timespec="minutes"),
        "workers": names,
        "records": records,
    }

    if dry_run:
        log("[הרצה יבשה] דוגמה (לא נשלח):")
        for r in records[:8]:
            log(f"  {r['time_clock_id']:>6} {r['date']} {r['first_in']}–{r['last_out']} = {r['hours']}h"
                + ("" if r["complete"] else "  (חסר יציאה)"))
        return {"records": len(records), "total_hours": total, "sent": False}

    url = ff["api_url"].rstrip("/") + "/api/attendance/sync"
    resp = requests.post(url, json=payload, headers={"x-api-key": ff["api_key"]}, timeout=30)
    if not resp.ok:
        raise RuntimeError(f"שגיאת שליחה {resp.status_code}: {resp.text[:300]}")
    log(f"  ✓ נשלח בהצלחה: {resp.json()}")
    return {"records": len(records), "total_hours": total, "sent": True, "response": resp.json()}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="YYYY-MM (ברירת מחדל: החודש הנוכחי)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_config()
    try:
        sync_once(cfg, ym=args.month, dry_run=args.dry_run, log=print)
    except Exception as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
