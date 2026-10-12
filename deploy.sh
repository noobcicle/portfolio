#!/usr/bin/env bash
# Ship okay-cool.net: commit, push to GitHub, have Pi Black pull it right now, then check the live site.
# The Pi also pulls on its own every 2 minutes, so this still works if the Pi is unreachable.
# Usage: bash deploy.sh "what changed"
set -euo pipefail
cd "$(dirname "$0")"
PI_HOST="${DEPLOY_PI_HOST:-thaddeus@192.168.1.211}"
PI_PATH=/opt/okay-cool/repo
msg="${1:-Update site}"
git add -A
if git diff --cached --quiet; then echo "Nothing to commit."; else git commit -q -m "$msg"; fi
git push -q origin main
if ssh -o BatchMode=yes -o ConnectTimeout=5 "$PI_HOST" "$PI_PATH/ops/pi/deploy.sh"; then
  sleep 1
  curl -s -o /dev/null -w "https://okay-cool.net -> %{http_code} in %{time_total}s\n" https://okay-cool.net/
else
  echo "Pi unreachable; its 2-minute auto-pull will catch it."
fi
