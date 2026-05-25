#!/bin/bash
# Deploy script for the VPS — run from ~/ken-trading.
#
# Replaces the manual git pull + npm install + pm2 restart sequence with one
# command that survives any local junk in the working tree (stray staged files,
# package-lock.json regen by npm install, accidental npm run build, etc).
#
# Safe: only touches tracked files. .env, bot/data/, bot/configs/, bot/node_modules/,
# bot/signal-bots/, bot/trade-audit.log and any untracked file you've added are all
# preserved because they're gitignored or simply not tracked by git.

set -euo pipefail

cd "$(dirname "$0")"

# Sanity: refuse to run anywhere except a clone of this repo.
if [ ! -f bot/package.json ] || [ ! -d bot/src ]; then
  echo "✗ deploy.sh must be run from the repo root (~/ken-trading)" >&2
  exit 1
fi

# Sanity: warn if .env got nuked somehow. We never touch it but it's the
# single source of irreplaceable secrets (KEY_ENCRYPTION_SECRET, JWT_SECRET).
if [ ! -f bot/.env ]; then
  echo "⚠  bot/.env is missing! Restore it before restarting or all users will be locked out." >&2
fi

echo "── Fetching latest from origin ──"
git fetch origin

OLD_HEAD=$(git rev-parse HEAD)

echo "── Resetting working tree to origin/master ──"
# --hard discards modified tracked files (rebuilt package-lock.json, accidentally
# staged files, npm run build artifacts) but leaves untracked + gitignored files
# alone. That's exactly the cleanup we want.
git reset --hard origin/master

NEW_HEAD=$(git rev-parse HEAD)

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  echo "── Already at latest ($NEW_HEAD), nothing to deploy ──"
  exit 0
fi

echo "── Moved $OLD_HEAD → $NEW_HEAD ──"

# Detect node_modules vs package-lock.json drift. npm writes a copy of the
# resolved lockfile to node_modules/.package-lock.json on every successful
# install — diffing it against the project lock catches every case where
# install is needed (missing deps, stale node_modules from a prior failed
# install, version drift after a pull, etc). Way more reliable than just
# comparing git versions of package.json.
NM_LOCK="bot/node_modules/.package-lock.json"
if [ ! -d bot/node_modules ] || [ ! -f "$NM_LOCK" ] || ! cmp -s bot/package-lock.json "$NM_LOCK"; then
  echo "── node_modules out of sync with bot/package-lock.json → npm install ──"
  ( cd bot && npm install --no-audit --no-fund )
else
  echo "── node_modules in sync with bot/package-lock.json, skipping install ──"
fi

echo "── Restarting trading-bot ──"
pm2 restart trading-bot

echo "── Done — currently on $(git log --oneline -1) ──"
echo "── bot/public/assets/ ──"
ls -la bot/public/assets/
