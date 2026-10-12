#!/usr/bin/env bash
# One-time (idempotent) setup of okay-cool.net on Pi Black. Run with sudo from the checkout:
#   sudo bash /opt/okay-cool/repo/ops/pi/install.sh
# The Cloudflare Tunnel itself is set up separately (its token never lives in this repo).
set -euo pipefail
OPS="$(cd "$(dirname "$0")" && pwd)"
install -d -o thaddeus -g thaddeus /var/www/okay-cool.net
install -m 644 "$OPS/okay-cool-headers.conf" /etc/nginx/snippets/okay-cool-headers.conf
install -m 644 "$OPS/nginx-okay-cool.conf" /etc/nginx/sites-available/okay-cool
ln -sf /etc/nginx/sites-available/okay-cool /etc/nginx/sites-enabled/okay-cool
nginx -t -q
systemctl reload nginx
cat > /etc/cron.d/okay-cool <<CRON
# okay-cool.net: publish new commits within 2 minutes, refresh the live status every minute
*/2 * * * * thaddeus $OPS/deploy.sh >> /var/log/okay-cool-deploy.log 2>&1
* * * * * root /usr/bin/python3 $OPS/status.py >> /var/log/okay-cool-status.log 2>&1
CRON
chmod 644 /etc/cron.d/okay-cool
touch /var/log/okay-cool-deploy.log && chown thaddeus /var/log/okay-cool-deploy.log
sudo -u thaddeus "$OPS/deploy.sh" --force
/usr/bin/python3 "$OPS/status.py"
echo "okay-cool.net installed: nginx on 127.0.0.1:8088, deploy every 2 min, status every minute."
