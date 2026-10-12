#!/usr/bin/env bash
# Ship okay-cool.net: commit everything, push, and GitHub Pages rebuilds in about a minute.
# Usage: bash deploy.sh "what changed"
set -euo pipefail
cd "$(dirname "$0")"
msg="${1:-Update site}"
git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -q -m "$msg"
fi
git push -q origin main
echo "Pushed. GitHub Pages is rebuilding; live at https://okay-cool.net in ~1 min."
gh api repos/noobcicle/portfolio/pages/builds/latest --jq '"Last build: \(.status) (\(.created_at))"' 2>/dev/null || true
