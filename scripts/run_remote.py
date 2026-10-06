"""Upload a script to the farm-flow VM and run it: python run_remote.py <local> <remote_cmd...>"""
import sys, re, paramiko

src = open(r'C:\GUYAPP\farm-flow\deploy.py', encoding='utf-8').read()
HOST = re.search(r"^HOST = '([^']+)'", src, re.M).group(1)
USER = re.search(r"^USER = '([^']+)'", src, re.M).group(1)
PASS = re.search(r"^PASS = '([^']+)'", src, re.M).group(1)

local = sys.argv[1]
cmd = ' '.join(sys.argv[2:])
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)
sftp = ssh.open_sftp()
remote = '/tmp/' + local.replace('\\', '/').split('/')[-1]
sftp.put(local, remote)
sftp.close()
full = cmd  # runs as the regular login user, no sudo
_, out, err = ssh.exec_command(full)
o = out.read().decode('utf-8', errors='replace')
e = err.read().decode('utf-8', errors='replace')
print(o)
e = '\n'.join(l for l in e.splitlines() if 'sudo' not in l.lower())
if e.strip():
    print('ERR:', e)
ssh.close()
