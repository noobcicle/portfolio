#!/usr/bin/env bash
# Pull okay-cool.net from GitHub and publish it to the nginx webroot.
# Runs from cron every 2 minutes as thaddeus; silent when nothing changed.
# deploy.sh --force republishes even without a new commit.
set -euo pipefail
REPO=/opt/okay-cool/repo
WEB=/var/www/okay-cool.net
cd "$REPO"
git fetch -q origin main
if [ "${1:-}" != "--force" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi
git reset -q --hard origin/main
# status.json is generated on the Pi; excluding it also keeps --delete from removing it.
rsync -a --delete \
  --exclude '.git' --exclude 'tools/' --exclude 'ops/' --exclude 'README.md' \
  --exclude 'CNAME' --exclude '.nojekyll' --exclude 'deploy.sh' --exclude '.gitignore' \
  --exclude 'status.json' \
  "$REPO/" "$WEB/"
echo "$(date -Is) deployed $(git log -1 --format='%h %s')"
