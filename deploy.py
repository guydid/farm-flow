#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Farm Flow deployment script to VM 192.168.1.230"""
import paramiko
import os
import sys

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = '192.168.1.231'
USER = 'nitur'
PASS = '76453'
REMOTE_DIR = '/home/nitur/farm-flow'

# Optional: set ANTHROPIC_API_KEY env var before running to enable AI extraction
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

# Optional: HuggingFace Inference API token (free account at huggingface.co)
# Used for OCR when no Anthropic API key is set. Free tier: ~1000 req/day.
HF_TOKEN = os.environ.get('HF_TOKEN', '')
# Optional: override the HuggingFace model (default: Qwen/Qwen2.5-VL-3B-Instruct)
HF_MODEL = os.environ.get('HF_MODEL', '')
# Groq API key for Telegram bot NLP (free tier: https://console.groq.com)
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')

# Registration: set ALLOW_REGISTRATION=true env var to enable public sign-up
ALLOW_REGISTRATION = os.environ.get('ALLOW_REGISTRATION', 'false')

# Cloudflare tunnel public domain (used for CORS whitelist)
PUBLIC_DOMAIN = os.environ.get('PUBLIC_DOMAIN', 'https://farm.nitur-ai.com')

# Google OAuth credentials
GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID',     '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
APP_BASE_URL         = PUBLIC_DOMAIN

def run(ssh, cmd, sudo=False):
    if sudo:
        cmd = f"echo '{PASS}' | sudo -S bash -c \"{cmd.replace('\"', chr(34))}\""
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        print(f"  OUT: {out}")
    if err and 'sudo' not in err.lower() and '[sudo]' not in err.lower():
        print(f"  ERR: {err}")
    return out, err

print("=== Farm Flow Deployment ===")
print(f"Target: {USER}@{HOST}")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)
print("[OK] Connected to VM")

# Retrieve or generate JWT_SECRET (persisted on VM so tokens survive redeploys)
def get_or_create_jwt_secret(ssh_conn):
    """Read JWT_SECRET from VM's persistent file, or generate and save a new one."""
    secret_file = '/home/nitur/farm-flow/.jwt_secret'
    stdin, stdout, stderr = ssh_conn.exec_command(f'cat {secret_file} 2>/dev/null')
    existing = stdout.read().decode().strip()
    if existing and len(existing) >= 32:
        return existing
    # Generate a secure 64-char hex secret
    import secrets as _secrets
    new_secret = _secrets.token_hex(32)
    stdin, stdout, stderr = ssh_conn.exec_command(
        f"echo '{new_secret}' > {secret_file} && chmod 600 {secret_file}"
    )
    stdout.channel.recv_exit_status()
    print("  [OK] Generated new JWT_SECRET (saved on VM)")
    return new_secret

JWT_SECRET = get_or_create_jwt_secret(ssh)
print(f"  JWT_SECRET: {JWT_SECRET[:8]}...{JWT_SECRET[-4:]} (persisted on VM)")

sftp = ssh.open_sftp()

# Create directories
print("\n[1] Setting up directories...")
run(ssh, f"mkdir -p {REMOTE_DIR}/backend/data {REMOTE_DIR}/frontend {REMOTE_DIR}/backend/uploads")
print("[OK] Directories ready")

# Upload backend
print("\n[2] Uploading backend...")
backend_local = 'C:/GUYAPP/farm-flow/backend'
backend_remote = f'{REMOTE_DIR}/backend'

for f in ['server.js', 'package.json']:
    local_path = os.path.join(backend_local, f)
    if os.path.exists(local_path):
        sftp.put(local_path, f'{backend_remote}/{f}')
        print(f"  [OK] {f}")

# Install backend dependencies
print("\n[3] Installing backend dependencies...")
run(ssh, f"cd {REMOTE_DIR}/backend && npm install --production 2>&1 | tail -3")
print("  [OK] Dependencies installed")

# Download Tesseract language data (only if missing) — download on Windows, upload via SFTP
print("\n[3b] Checking Tesseract OCR language files...")
run(ssh, f"mkdir -p {REMOTE_DIR}/backend/tessdata")
out_eng, _ = run(ssh, f"test -f {REMOTE_DIR}/backend/tessdata/eng.traineddata && stat -c%s {REMOTE_DIR}/backend/tessdata/eng.traineddata || echo 'missing'")
out_heb, _ = run(ssh, f"test -f {REMOTE_DIR}/backend/tessdata/heb.traineddata && stat -c%s {REMOTE_DIR}/backend/tessdata/heb.traineddata || echo 'missing'")
# Require eng >= 1MB and heb >= 1MB (downloaded files are 23MB and 5MB)
eng_ok = out_eng.strip().isdigit() and int(out_eng.strip()) > 1_000_000
heb_ok = out_heb.strip().isdigit() and int(out_heb.strip()) > 1_000_000
if eng_ok and heb_ok:
    print(f"  [OK] Tessdata already present (eng={out_eng.strip()}B, heb={out_heb.strip()}B)")
else:
    import urllib.request, gzip, io as _io
    sftp3 = ssh.open_sftp()
    tessdata_remote = f'{REMOTE_DIR}/backend/tessdata'
    langs_needed = []
    if not eng_ok: langs_needed.append(('eng', 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz'))
    if not heb_ok: langs_needed.append(('heb', 'https://tessdata.projectnaptha.com/4.0.0/heb.traineddata.gz'))
    for lang, url in langs_needed:
        print(f"  Downloading {lang}.traineddata from CDN (via this machine)...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=180) as r:
            gz_bytes = r.read()
        raw_bytes = gzip.decompress(gz_bytes)
        print(f"    {lang}: {len(gz_bytes):,}B compressed → {len(raw_bytes):,}B")
        sftp3.putfo(_io.BytesIO(raw_bytes), f'{tessdata_remote}/{lang}.traineddata')
        print(f"    {lang}.traineddata uploaded to VM")
    sftp3.close()
    print("  [OK] Tessdata ready")

# Upload frontend dist
print("\n[4] Uploading frontend build...")
dist_local = 'C:/GUYAPP/farm-flow/farm-flow-49ecc86e/dist'

def upload_dist(local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except:
        pass
    for item in os.listdir(local_dir):
        local_path = os.path.join(local_dir, item)
        remote_path = remote_dir + '/' + item
        if os.path.isfile(local_path):
            sftp.put(local_path, remote_path)
        elif os.path.isdir(local_path):
            upload_dist(local_path, remote_path)

upload_dist(dist_local, f'{REMOTE_DIR}/frontend')
print("  [OK] Frontend files uploaded")

sftp.close()

# Update systemd service with API key (if provided)
print("\n[5] Updating systemd service...")
ALLOWED_ORIGINS = f"{PUBLIC_DOMAIN},http://192.168.1.231,http://192.168.1.231:3002"

service_content = f"""[Unit]
Description=Farm Flow Backend
After=network.target

[Service]
Type=simple
User=nitur
WorkingDirectory={REMOTE_DIR}/backend
Environment=PORT=3002
Environment=DB_PATH={REMOTE_DIR}/backend/data/farmflow.db
Environment=JWT_SECRET={JWT_SECRET}
Environment=ANTHROPIC_API_KEY={ANTHROPIC_API_KEY}
Environment=HF_TOKEN={HF_TOKEN}
Environment=HF_MODEL={HF_MODEL}
Environment=GROQ_API_KEY={GROQ_API_KEY}
Environment=ALLOW_REGISTRATION={ALLOW_REGISTRATION}
Environment=ALLOWED_ORIGINS={ALLOWED_ORIGINS}
Environment=GOOGLE_CLIENT_ID={GOOGLE_CLIENT_ID}
Environment=GOOGLE_CLIENT_SECRET={GOOGLE_CLIENT_SECRET}
Environment=APP_BASE_URL={APP_BASE_URL}
ExecStart=/usr/bin/node --dns-result-order=ipv4first server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"""

# Write service file via SSH (avoid shell quoting issues)
sftp2 = ssh.open_sftp()
import io
sftp2.putfo(io.BytesIO(service_content.encode('utf-8')), f'/tmp/farm-flow.service')
sftp2.close()

run(ssh, f"cp /tmp/farm-flow.service /etc/systemd/system/farm-flow.service", sudo=True)
run(ssh, "systemctl daemon-reload", sudo=True)
run(ssh, "systemctl restart farm-flow", sudo=True)
print("  [OK] Service restarted")

# Quick wait then status check
import time
time.sleep(2)

print("\n[6] Status check...")
out, _ = run(ssh, "systemctl is-active farm-flow", sudo=True)
print(f"  Service status: {out}")

out, _ = run(ssh, "curl -s http://localhost:3002/api/health")
print(f"  Backend health: {out}")

out, _ = run(ssh, "curl -s http://localhost:3002/api/settings/ai")
print(f"  AI key status:  {out}")

if ANTHROPIC_API_KEY:
    print("\n[OK] Deployed WITH Anthropic API key - AI document extraction enabled!")
else:
    print("\n[WARN] Deployed WITHOUT Anthropic API key - AI extraction disabled.")
    print("       To enable: set ANTHROPIC_API_KEY environment variable before running deploy.py")
    print("       Example (Windows): set ANTHROPIC_API_KEY=sk-ant-api03-... && python deploy.py")
    print("       Example (Linux):   ANTHROPIC_API_KEY=sk-ant-api03-... python deploy.py")

print(f"\n=== Deployment complete! ===")
print(f"   App URL: http://192.168.1.231")

ssh.close()
