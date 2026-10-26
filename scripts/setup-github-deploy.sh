#!/usr/bin/env bash
# הגדרה חד-פעמית של פריסה אוטומטית מ-GitHub Actions ל-VPS.
# מריצים פעם אחת מהמחשב (Git Bash):  bash scripts/setup-github-deploy.sh
# מה זה עושה:
#   1. מאשר את מפתח הפריסה (.deploy_keys/ff_deploy_key.pub) למשתמש nitur בשרת
#   2. מרשה ל-nitur להפעיל מחדש את השירות בלי סיסמה (sudoers מצומצם)
#   3. שומר ב-GitHub את הסודות VPS_HOST / VPS_KNOWN_HOSTS / VPS_SSH_KEY
#   4. בודק חיבור SSH עם המפתח, דוחף את main ועוקב אחרי ריצת הפריסה
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=178.105.41.152
KEY=.deploy_keys/ff_deploy_key
[ -f "$KEY" ] && [ -f "$KEY.pub" ] && [ -f .deploy_keys/known_hosts.txt ] || { echo "חסרים קבצי מפתח ב-.deploy_keys/"; exit 1; }

echo "== 1/4 מאשר את מפתח הפריסה בשרת (כ-root)"
scp -q "$KEY.pub" "root@$HOST:/tmp/ff_deploy_key.pub"
ssh -o BatchMode=yes "root@$HOST" 'set -e
  install -d -m 700 -o nitur -g nitur /home/nitur/.ssh
  touch /home/nitur/.ssh/authorized_keys
  grep -qF "$(cat /tmp/ff_deploy_key.pub)" /home/nitur/.ssh/authorized_keys || cat /tmp/ff_deploy_key.pub >> /home/nitur/.ssh/authorized_keys
  chown nitur:nitur /home/nitur/.ssh/authorized_keys; chmod 600 /home/nitur/.ssh/authorized_keys; rm -f /tmp/ff_deploy_key.pub
  printf "nitur ALL=(root) NOPASSWD: /usr/bin/systemctl restart farm-flow, /usr/bin/systemctl status farm-flow\n" > /etc/sudoers.d/farmflow-deploy
  chmod 440 /etc/sudoers.d/farmflow-deploy && visudo -cf /etc/sudoers.d/farmflow-deploy >/dev/null
  echo "   authorized_keys: $(wc -l < /home/nitur/.ssh/authorized_keys) מפתחות, sudoers תקין"'

echo "== 2/4 בודק חיבור כ-nitur עם המפתח"
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY" "nitur@$HOST" 'echo "   ok: $(whoami)@$(hostname)"; sudo -n systemctl status farm-flow --no-pager | head -3'

echo "== 3/4 שומר סודות ב-GitHub"
gh secret set VPS_HOST --body "$HOST"
gh secret set VPS_KNOWN_HOSTS < .deploy_keys/known_hosts.txt
gh secret set VPS_SSH_KEY < "$KEY"
gh secret list

echo "== 4/4 דוחף ל-GitHub ועוקב אחרי הפריסה"
git push origin main
sleep 10
RUN_ID=$(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status || { echo "הריצה נכשלה. לוג: gh run view $RUN_ID --log-failed"; exit 1; }
echo "✔ הפריסה מ-GitHub פעילה. מעכשיו כל push ל-main נפרס אוטומטית."
