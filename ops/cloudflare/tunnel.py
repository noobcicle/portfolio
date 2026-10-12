"""Stand up the Cloudflare Tunnel that serves okay-cool.net from Pi Black.

    python3 ops/cloudflare/tunnel.py <path-to-api-token-file>

Idempotent. Needs a token with Account > Cloudflare Tunnel > Edit, Zone > Zone Settings > Edit,
Zone > DNS > Edit and Zone > Zone > Read. The tunnel's own run-token goes straight to the Pi
(/etc/cloudflared/okay-cool.env, 0600) over SSH and is never written anywhere else.
"""
import json
import re
import subprocess
import sys
import urllib.request

ZONE_NAME = "okay-cool.net"
TUNNEL_NAME = "okay-cool-black"
PI = "thaddeus@192.168.1.211"
HOSTS = ["okay-cool.net", "www.okay-cool.net"]
ORIGIN = "http://127.0.0.1:8088"
API = "https://api.cloudflare.com/client/v4"


def read_token(path):
    raw = open(path, "rb").read()
    if path.endswith(".rtf"):
        raw = subprocess.run(["textutil", "-convert", "txt", "-stdout", path], capture_output=True).stdout
    m = re.findall(rb"[A-Za-z0-9_-]{40,}", raw)
    if not m:
        sys.exit("no token found in " + path)
    return m[-1].decode()


def call(token, method, path, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        d = json.load(e)
    if not d.get("success"):
        raise RuntimeError(f"{method} {path}: {d.get('errors')}")
    return d["result"]


def ssh(cmd, stdin=None):
    return subprocess.run(["ssh", "-o", "BatchMode=yes", PI, cmd], input=stdin, capture_output=True, text=True, check=True).stdout


def main():
    token = read_token(sys.argv[1])
    zone = call(token, "GET", f"/zones?name={ZONE_NAME}")[0]
    zid, acct = zone["id"], zone["account"]["id"]

    # 1. the tunnel (reuse it if it already exists)
    existing = [t for t in call(token, "GET", f"/accounts/{acct}/cfd_tunnel?name={TUNNEL_NAME}&is_deleted=false")]
    tunnel = existing[0] if existing else call(token, "POST", f"/accounts/{acct}/cfd_tunnel",
                                               {"name": TUNNEL_NAME, "config_src": "cloudflare"})
    tid = tunnel["id"]
    print("tunnel", TUNNEL_NAME, tid[:8] + "…", "(reused)" if existing else "(created)")

    # 2. ingress: both names go to nginx on the Pi's loopback, anything else 404s at the edge
    ingress = [{"hostname": h, "service": ORIGIN} for h in HOSTS] + [{"service": "http_status:404"}]
    call(token, "PUT", f"/accounts/{acct}/cfd_tunnel/{tid}/configurations", {"config": {"ingress": ingress}})
    print("ingress:", ", ".join(HOSTS), "->", ORIGIN)

    # 3. run-token to the Pi, then the hardened service
    run_token = call(token, "GET", f"/accounts/{acct}/cfd_tunnel/{tid}/token")
    ssh("sudo install -d -m 700 /etc/cloudflared && sudo tee /etc/cloudflared/okay-cool.env >/dev/null && sudo chmod 600 /etc/cloudflared/okay-cool.env",
        stdin=f"TUNNEL_TOKEN={run_token}\n")
    unit = open(__file__.replace("cloudflare/tunnel.py", "pi/cloudflared.service")).read()
    ssh("sudo tee /etc/systemd/system/cloudflared.service >/dev/null && sudo systemctl daemon-reload && "
        "sudo systemctl enable --now cloudflared && sudo systemctl restart cloudflared", stdin=unit)
    print("cloudflared service installed and started on the Pi")

    # 4. DNS: replace GitHub Pages' records with proxied CNAMEs to the tunnel
    target = f"{tid}.cfargotunnel.com"
    for host in HOSTS:
        for rec in call(token, "GET", f"/zones/{zid}/dns_records?name={host}&per_page=100"):
            if rec["type"] in ("A", "AAAA", "CNAME") and rec["content"] != target:
                call(token, "DELETE", f"/zones/{zid}/dns_records/{rec['id']}")
                print("  removed", rec["type"], host, rec["content"])
        if not any(r["type"] == "CNAME" for r in call(token, "GET", f"/zones/{zid}/dns_records?name={host}")):
            call(token, "POST", f"/zones/{zid}/dns_records", {"type": "CNAME", "name": host, "content": target,
                                                              "proxied": True, "ttl": 1,
                                                              "comment": "Cloudflare Tunnel to Pi Black (okay-cool.net portfolio)"})
            print("  added CNAME", host, "->", "<tunnel>.cfargotunnel.com (proxied)")

    # 5. edge settings: HTTPS everywhere, modern TLS, HTTP/3
    for key, value in (("ssl", "strict"), ("always_use_https", "on"), ("min_tls_version", "1.2"),
                       ("tls_1_3", "on"), ("http3", "on"), ("automatic_https_rewrites", "on"), ("early_hints", "on")):
        try:
            call(token, "PATCH", f"/zones/{zid}/settings/{key}", {"value": value})
            print(f"  setting {key} = {value}")
        except RuntimeError as e:
            print(f"  setting {key} skipped: {e}")


if __name__ == "__main__":
    main()
