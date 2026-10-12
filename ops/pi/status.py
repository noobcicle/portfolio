#!/usr/bin/env python3
"""Write /var/www/okay-cool.net/status.json, the Pi's vitals for the site's live widgets.

Runs from cron every minute as root (it reads the nginx log and the cloudflared journal).
Everything here is safe to publish: no addresses, no tokens, no hostnames beyond the model.
"""
import datetime
import json
import os
import re
import subprocess

WEB = "/var/www/okay-cool.net"
LOG = "/var/log/nginx/okay-cool.access.log"
REPO = "/opt/okay-cool/repo"


def first(path, default=""):
    try:
        with open(path) as fh:
            return fh.read().strip("\x00\n ")
    except OSError:
        return default


def meminfo():
    vals = {}
    for line in first("/proc/meminfo").splitlines():
        k, v = line.split(":", 1)
        vals[k] = int(v.split()[0])
    return round(100 * (1 - vals["MemAvailable"] / vals["MemTotal"]))


def requests_today():
    stamp = datetime.datetime.now().strftime("[%d/%b/%Y:")
    n = 0
    try:
        with open(LOG, errors="replace") as fh:
            for line in fh:
                if stamp in line and "/status.json" not in line and "/cdn-cgi/" not in line:
                    n += 1
    except OSError:
        return None
    return n


def last_deploy():
    try:
        # root reading thaddeus's checkout: git refuses "dubious ownership" without this
        out = subprocess.run(["git", "-c", f"safe.directory={REPO}", "-C", REPO, "log", "-1", "--format=%h%x1f%s%x1f%cI"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        commit, subject, when = out.split("\x1f")
        return {"commit": commit, "subject": subject, "time": when}
    except Exception:
        return None


def tunnel():
    """Latest registration per connection index, from cloudflared's journal."""
    try:
        out = subprocess.run(["journalctl", "-u", "cloudflared", "--since", "-7 days", "-o", "cat", "--no-pager"],
                             capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return None
    conns = {}
    for line in out.splitlines():
        if "Registered tunnel connection" not in line:
            continue
        idx = re.search(r"connIndex=(\d+)", line)
        ip = re.search(r"\bip=(\S+)", line)
        loc = re.search(r"\blocation=(\S+)", line)
        if idx:
            conns[idx.group(1)] = (ip.group(1) if ip else "", loc.group(1) if loc else "")
    if not conns:
        return None
    ips = [ip for ip, _ in conns.values()]
    fam = "IPv6" if all(":" in ip for ip in ips) else "IPv4" if not any(":" in ip for ip in ips) else "IPv4 + IPv6"
    return {"connections": len(conns), "family": fam, "edges": sorted({loc for _, loc in conns.values() if loc})}


def main():
    model = first("/proc/device-tree/model")
    host = "Raspberry Pi 4" if "Raspberry Pi 4" in model else (model or "Raspberry Pi")
    os_name = next((l.split("=", 1)[1].strip('"') for l in first("/etc/os-release").splitlines()
                    if l.startswith("PRETTY_NAME=")), "")
    temp = first("/sys/class/thermal/thermal_zone0/temp")
    status = {
        "host": host,
        "os": os_name,
        "uptime_s": int(float(first("/proc/uptime", "0").split()[0])),
        "temp_c": round(int(temp) / 1000, 1) if temp.isdigit() else None,
        "load1": float(first("/proc/loadavg", "0").split()[0]),
        "mem_used_pct": meminfo(),
        "requests_today": requests_today(),
        "deploy": last_deploy(),
        "tunnel": tunnel(),
        "generated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    tmp = os.path.join(WEB, ".status.json.tmp")
    with open(tmp, "w") as fh:
        json.dump(status, fh)
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(WEB, "status.json"))


if __name__ == "__main__":
    main()
