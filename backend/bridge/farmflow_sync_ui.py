# -*- coding: utf-8 -*-
"""
farmflow_sync_ui.py — ממשק גרפי לגשר נוכחות farm-flow
=====================================================
טופס הגדרות, בדיקת שעון, הרצה יבשה, סנכרון ידני/אוטומטי, מגש מערכת (system tray),
הפעלה אוטומטית עם Windows, והסרה מהמערכת — הכל בחלון אחד, בלי לערוך JSON.

הרצה:  pythonw farmflow_sync_ui.py   (או run_farmflow_ui.vbs)
תלויות:  pip install pyzk requests pystray pillow   (Tkinter מובנה ב-Python)
"""
import os
import sys
import queue
import threading
import subprocess
from datetime import datetime

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox

import farmflow_sync as core

# ── מגש מערכת (אופציונלי — אם הספריות חסרות, האפליקציה עדיין רצה כחלון רגיל) ──
try:
    import pystray
    from PIL import Image, ImageDraw
    HAS_TRAY = True
except Exception:
    HAS_TRAY = False

try:
    import winreg
    HAS_WINREG = True
except Exception:
    HAS_WINREG = False

APP_NAME   = "FarmFlowSyncBridge"
TASK_NAME  = "FarmFlow Attendance Sync"   # תואם ל-install_farmflow_sync.bat
RUN_KEY    = r"Software\Microsoft\Windows\CurrentVersion\Run"
SCRIPT     = os.path.abspath(__file__)
CREATE_NO_WINDOW = 0x08000000


# ── הפעלה אוטומטית עם Windows (HKCU Run) ─────────────────────────────────────
def _pythonw() -> str:
    exe = sys.executable
    pyw = exe.replace("python.exe", "pythonw.exe")
    return pyw if os.path.exists(pyw) else exe


def _autostart_cmd() -> str:
    return f'"{_pythonw()}" "{SCRIPT}"'


def is_autostart() -> bool:
    if not HAS_WINREG:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
        return True
    except FileNotFoundError:
        return False
    except Exception:
        return False


def set_autostart(on: bool):
    if not HAS_WINREG:
        raise RuntimeError("winreg לא זמין (לא Windows?)")
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, _autostart_cmd())
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except FileNotFoundError:
                pass


def delete_scheduled_task() -> str:
    """מוחק את המשימה המתוזמנת (אם קיימת). מחזיר טקסט תוצאה."""
    try:
        r = subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
                           capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
        if r.returncode == 0:
            return "המשימה המתוזמנת הוסרה"
        if "cannot find" in (r.stderr + r.stdout).lower() or "ERROR" in r.stderr.upper():
            return "לא נמצאה משימה מתוזמנת (כבר לא קיימת)"
        return (r.stderr or r.stdout or "").strip() or "הושלם"
    except Exception as e:
        return f"שגיאה: {e}"


class SyncUI:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.busy = False
        self._auto_after = None
        self.icon = None
        self.cfg = core.load_config()

        root.title("גשר נוכחות → farm-flow")
        root.geometry("740x660")
        root.minsize(660, 560)

        self._build()
        self._load_into_fields()
        self.root.after(100, self._drain_queue)

        # מגש מערכת + יירוט סגירה/מזעור
        self.root.protocol("WM_DELETE_WINDOW", self.hide_to_tray)
        self.root.bind("<Unmap>", self._on_minimize)
        if HAS_TRAY:
            self._start_tray()

        if self.auto_var.get():
            self._schedule_auto()
        self._log("מוכן. מלא הגדרות ולחץ 'בדוק שעון' או 'סנכרן עכשיו'.")
        if not HAS_TRAY:
            self._log("⚠️ pystray/pillow לא מותקנים — מגש המערכת מושבת. התקן: pip install pystray pillow")

    # ── בניית הממשק ──────────────────────────────────────────────────────────
    def _build(self):
        frm = ttk.LabelFrame(self.root, text="הגדרות")
        frm.pack(fill="x", padx=10, pady=(10, 6))
        frm.columnconfigure(1, weight=1)
        frm.columnconfigure(3, weight=1)

        self.e_ip   = self._row(frm, "כתובת השעון:", 0, 0)
        self.e_port = self._row(frm, "פורט:", 0, 2, width=8)
        self.e_url  = self._row(frm, "כתובת farm-flow:", 1, 0, colspan=3)
        self.e_key  = self._row(frm, "מפתח API:", 2, 0, colspan=3, show="•")
        self.e_farm = self._row(frm, "מזהה משק (farm_id):", 3, 0, colspan=3)
        self.e_wrk  = self._row(frm, "תיקיית WRK:", 4, 0, colspan=3)

        self.show_key = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text="הצג מפתח", variable=self.show_key,
                        command=self._toggle_key).grid(row=5, column=1, sticky="w", padx=6, pady=4)
        ttk.Button(frm, text="💾 שמור הגדרות", command=self.on_save)\
            .grid(row=5, column=3, sticky="e", padx=6, pady=4)

        # פעולות
        act = ttk.Frame(self.root)
        act.pack(fill="x", padx=10, pady=4)
        self.btn_test = ttk.Button(act, text="🔌 בדוק שעון", command=self.on_test)
        self.btn_dry  = ttk.Button(act, text="🧪 הרצה יבשה", command=self.on_dry)
        self.btn_sync = ttk.Button(act, text="⬆️ סנכרן עכשיו", command=self.on_sync)
        self.btn_test.pack(side="right", padx=4)
        self.btn_dry.pack(side="right", padx=4)
        self.btn_sync.pack(side="right", padx=4)
        ttk.Label(act, text="חודש:").pack(side="left")
        self.e_month = ttk.Entry(act, width=10)
        self.e_month.pack(side="left", padx=4)
        self._enable_clipboard(self.e_month)

        # סנכרון אוטומטי
        auto = ttk.Frame(self.root)
        auto.pack(fill="x", padx=10, pady=4)
        self.auto_var = tk.BooleanVar(value=bool(self.cfg.get("ui", {}).get("auto_sync", False)))
        ttk.Checkbutton(auto, text="סנכרון אוטומטי כל", variable=self.auto_var,
                        command=self.on_toggle_auto).pack(side="right")
        self.e_interval = ttk.Entry(auto, width=5)
        self.e_interval.pack(side="right", padx=4)
        self.e_interval.insert(0, str(self.cfg.get("ui", {}).get("interval_min", 30)))
        self._enable_clipboard(self.e_interval)
        ttk.Label(auto, text="דקות").pack(side="right")

        # מערכת (autostart / הסרה)
        sysf = ttk.LabelFrame(self.root, text="מערכת")
        sysf.pack(fill="x", padx=10, pady=4)
        self.autostart_var = tk.BooleanVar(value=is_autostart())
        ttk.Checkbutton(sysf, text="🚀 הפעל אוטומטית עם Windows (במגש המערכת)",
                        variable=self.autostart_var, command=self.on_autostart)\
            .pack(side="right", padx=6, pady=4)
        ttk.Button(sysf, text="🗑️ הסר מהמערכת", command=self.on_uninstall)\
            .pack(side="left", padx=6, pady=4)
        ttk.Button(sysf, text="➖ מזער למגש", command=self.hide_to_tray)\
            .pack(side="left", padx=6, pady=4)

        # לוג + סטטוס
        self.log_box = scrolledtext.ScrolledText(self.root, height=15, state="disabled",
                                                 font=("Consolas", 10), wrap="word")
        self.log_box.pack(fill="both", expand=True, padx=10, pady=(6, 4))
        self.status = tk.StringVar(value="—")
        ttk.Label(self.root, textvariable=self.status, anchor="e", relief="sunken")\
            .pack(fill="x", side="bottom")

    def _row(self, parent, label, r, c, colspan=1, width=None, show=None):
        ttk.Label(parent, text=label).grid(row=r, column=c, sticky="e", padx=6, pady=4)
        e = ttk.Entry(parent, width=width or 40, show=show)
        e.grid(row=r, column=c + 1, columnspan=colspan, sticky="ew", padx=6, pady=4)
        self._enable_clipboard(e)
        return e

    def _toggle_key(self):
        self.e_key.config(show="" if self.show_key.get() else "•")

    # ── גזור/העתק/הדבק — עובד בכל פריסת מקלדת (כולל עברית) ────────────────────
    @staticmethod
    def _sel(w):
        try:
            return int(w.index("sel.first")), int(w.index("sel.last"))
        except tk.TclError:
            return None

    def _paste(self, w):
        try:
            txt = w.clipboard_get()
        except tk.TclError:
            return "break"
        s = self._sel(w)
        if s:
            w.delete(s[0], s[1])
        w.insert("insert", txt)
        return "break"

    def _copy(self, w):
        s = self._sel(w)
        if s:
            w.clipboard_clear(); w.clipboard_append(w.get()[s[0]:s[1]])
        return "break"

    def _cut(self, w):
        s = self._sel(w)
        if s:
            w.clipboard_clear(); w.clipboard_append(w.get()[s[0]:s[1]]); w.delete(s[0], s[1])
        return "break"

    @staticmethod
    def _select_all(w):
        w.select_range(0, "end"); w.icursor("end"); return "break"

    def _enable_clipboard(self, w):
        # תפריט קליק-ימני
        m = tk.Menu(w, tearoff=0)
        m.add_command(label="גזור",    command=lambda: self._cut(w))
        m.add_command(label="העתק",    command=lambda: self._copy(w))
        m.add_command(label="הדבק",    command=lambda: self._paste(w))
        m.add_separator()
        m.add_command(label="בחר הכל", command=lambda: self._select_all(w))

        def popup(ev):
            try:
                m.tk_popup(ev.x_root, ev.y_root)
            finally:
                m.grab_release()
        w.bind("<Button-3>", popup)

        # Ctrl+C/V/X/A לפי keycode פיזי (חסין לפריסת מקלדת)
        def on_ctrl(ev):
            if not (ev.state & 0x4):   # Control מוחזק
                return
            kc = ev.keycode
            if   kc == 86: return self._paste(w)      # V
            elif kc == 67: return self._copy(w)       # C
            elif kc == 88: return self._cut(w)        # X
            elif kc == 65: return self._select_all(w) # A
        w.bind("<Key>", on_ctrl)

    # ── טעינה/איסוף ערכים ────────────────────────────────────────────────────
    def _load_into_fields(self):
        c, f = self.cfg.get("clock", {}), self.cfg.get("farmflow", {})
        self._set(self.e_ip, c.get("ip", "")); self._set(self.e_port, c.get("port", 4370))
        self._set(self.e_wrk, c.get("wrk_folder", r"C:\jbclock"))
        self._set(self.e_url, f.get("api_url", "")); self._set(self.e_key, f.get("api_key", ""))
        self._set(self.e_farm, f.get("farm_id", ""))

    def _set(self, entry, val):
        entry.delete(0, "end"); entry.insert(0, str(val))

    def _collect(self) -> dict:
        cfg = self.cfg
        cfg.setdefault("clock", {}); cfg.setdefault("farmflow", {}); cfg.setdefault("ui", {})
        try:
            port = int(self.e_port.get().strip() or 4370)
        except ValueError:
            port = 4370
        cfg["clock"].update({"ip": self.e_ip.get().strip(), "port": port,
                             "wrk_folder": self.e_wrk.get().strip()})
        cfg["clock"].setdefault("password", 0); cfg["clock"].setdefault("timeout", 10)
        cfg["farmflow"].update({"api_url": self.e_url.get().strip(),
                                "api_key": self.e_key.get().strip(),
                                "farm_id": self.e_farm.get().strip()})
        try:
            interval = max(1, int(self.e_interval.get().strip() or 30))
        except ValueError:
            interval = 30
        cfg["ui"].update({"auto_sync": bool(self.auto_var.get()), "interval_min": interval})
        return cfg

    def on_save(self):
        core.save_config(self._collect())
        self._log("✓ ההגדרות נשמרו ל-config.json"); self._set_status("הגדרות נשמרו")

    # ── הפעלה אוטומטית / הסרה ────────────────────────────────────────────────
    def on_autostart(self):
        try:
            set_autostart(self.autostart_var.get())
            self._log("✓ הופעל אוטומטית עם Windows" if self.autostart_var.get()
                      else "✓ בוטלה ההפעלה האוטומטית עם Windows")
        except Exception as e:
            messagebox.showerror("שגיאה", str(e)); self.autostart_var.set(is_autostart())

    def on_uninstall(self):
        if not messagebox.askyesno(
                "הסרה מהמערכת",
                "להסיר את הגשר מהמערכת?\n\n"
                "• תבוטל ההפעלה האוטומטית עם Windows\n"
                "• תימחק המשימה המתוזמנת (אם קיימת)\n\n"
                "הקבצים יישארו בתיקייה (אפשר למחוק ידנית).\nהאפליקציה תמשיך לרוץ עד שתסגור אותה."):
            return
        try:
            set_autostart(False)
        except Exception:
            pass
        self.autostart_var.set(False)
        msg = delete_scheduled_task()
        if self.auto_var.get():
            self.auto_var.set(False); self.on_toggle_auto()
        self._log(f"🗑️ הוסר מהמערכת — {msg}")
        self._set_status("הוסר מהמערכת")
        messagebox.showinfo("הוסר מהמערכת",
                            f"הגשר הוסר מההפעלה האוטומטית.\n{msg}\n\n"
                            "כדי להסיר לגמרי: סגור את החלון ומחק את התיקייה C:\\jbclock\\(קבצי הגשר).")

    # ── הרצת פעולות ברקע ─────────────────────────────────────────────────────
    def _run_async(self, fn, label):
        if self.busy:
            return
        self.busy = True; self._set_buttons(False); self._set_status(f"{label}…")
        self._log(f"\n── {label} ──")

        def worker():
            try:
                fn(); self.q.put(("status", f"{label} — הסתיים בהצלחה"))
            except Exception as e:
                self.q.put(("log", f"✗ שגיאה: {e}")); self.q.put(("status", f"{label} — נכשל"))
            finally:
                self.q.put(("done", None))

        threading.Thread(target=worker, daemon=True).start()

    def on_test(self):
        cfg = self._collect()
        self._run_async(lambda: core.test_clock(cfg, log=self._log_threadsafe), "בדיקת שעון")

    def on_dry(self):
        cfg = self._collect(); ym = self.e_month.get().strip() or None
        self._run_async(lambda: core.sync_once(cfg, ym=ym, dry_run=True, log=self._log_threadsafe),
                        "הרצה יבשה")

    def on_sync(self):
        cfg = self._collect(); core.save_config(cfg); ym = self.e_month.get().strip() or None
        self._run_async(lambda: core.sync_once(cfg, ym=ym, dry_run=False, log=self._log_threadsafe),
                        "סנכרון")

    # ── סנכרון אוטומטי ───────────────────────────────────────────────────────
    def on_toggle_auto(self):
        self._collect(); core.save_config(self.cfg)
        if self.auto_var.get():
            self._schedule_auto()
            self._log(f"⏱️ סנכרון אוטומטי הופעל (כל {self.cfg['ui']['interval_min']} דקות)")
        else:
            if self._auto_after:
                self.root.after_cancel(self._auto_after); self._auto_after = None
            self._log("⏹️ סנכרון אוטומטי כובה")

    def _schedule_auto(self):
        if self._auto_after:
            self.root.after_cancel(self._auto_after)
        interval = int(self.cfg.get("ui", {}).get("interval_min", 30))
        self._auto_after = self.root.after(interval * 60_000, self._auto_tick)

    def _auto_tick(self):
        if self.auto_var.get() and not self.busy:
            self.on_sync()
        self._schedule_auto()

    # ── מגש מערכת ────────────────────────────────────────────────────────────
    def _icon_image(self, color=(46, 125, 50)):
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((4, 4, 60, 60), fill=color, outline=(255, 255, 255, 255), width=3)
        d.line((32, 32, 32, 16), fill=(255, 255, 255, 255), width=4)   # מחוג שעות
        d.line((32, 32, 45, 38), fill=(255, 255, 255, 255), width=4)   # מחוג דקות
        return img

    def _start_tray(self):
        menu = pystray.Menu(
            pystray.MenuItem("פתח חלון", self._tray_show, default=True),
            pystray.MenuItem("סנכרן עכשיו", self._tray_sync),
            pystray.MenuItem("סנכרון אוטומטי", self._tray_toggle_auto,
                             checked=lambda i: bool(self.auto_var.get())),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("יציאה", self._tray_quit),
        )
        self.icon = pystray.Icon(APP_NAME, self._icon_image(), "גשר נוכחות farm-flow", menu)
        self.icon.run_detached()

    # callbacks של pystray רצים ב-thread אחר → ממרשלים ל-Tk עם root.after
    def _tray_show(self, *a):  self.root.after(0, self.show_window)
    def _tray_sync(self, *a):  self.root.after(0, self.on_sync)
    def _tray_quit(self, *a):  self.root.after(0, self.quit_app)

    def _tray_toggle_auto(self, *a):
        def do():
            self.auto_var.set(not self.auto_var.get()); self.on_toggle_auto()
            if self.icon: self.icon.update_menu()
        self.root.after(0, do)

    def hide_to_tray(self):
        if self.icon:
            self.root.withdraw()
            self._set_status("ממוזער למגש המערכת — לחץ על האייקון כדי לפתוח")
        else:
            self.root.iconify()  # אין מגש → מזעור רגיל

    def _on_minimize(self, event):
        if self.icon and self.root.state() == "iconic":
            self.hide_to_tray()

    def show_window(self):
        self.root.deiconify(); self.root.state("normal"); self.root.lift()
        self.root.focus_force()

    def quit_app(self):
        if self.icon:
            try: self.icon.stop()
            except Exception: pass
        self.root.destroy()

    # ── תור לוג thread-safe ──────────────────────────────────────────────────
    def _log_threadsafe(self, msg):
        self.q.put(("log", str(msg)))

    def _log(self, msg):
        self.log_box.config(state="normal")
        self.log_box.insert("end", f"[{datetime.now():%H:%M:%S}] {msg}\n")
        self.log_box.see("end"); self.log_box.config(state="disabled")

    def _drain_queue(self):
        try:
            while True:
                kind, data = self.q.get_nowait()
                if kind == "log":
                    self._log(data)
                elif kind == "status":
                    self._set_status(data)
                elif kind == "done":
                    self.busy = False; self._set_buttons(True)
        except queue.Empty:
            pass
        self.root.after(100, self._drain_queue)

    def _set_buttons(self, enabled):
        state = "normal" if enabled else "disabled"
        for b in (self.btn_test, self.btn_dry, self.btn_sync):
            b.config(state=state)

    def _set_status(self, text):
        self.status.set(f"{datetime.now():%H:%M} · {text}")
        if self.icon:
            try: self.icon.title = f"גשר נוכחות — {text}"
            except Exception: pass


def main():
    root = tk.Tk()
    try:
        root.tk.call("encoding", "system", "utf-8")
    except Exception:
        pass
    SyncUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
