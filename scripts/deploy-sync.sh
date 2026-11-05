#!/usr/bin/env bash
# Deploy the Wealth Trade Map save Worker. Passphrase lives in $KEY_FILE (mode 600, never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="${APP_KEY_FILE:-/home/box/.secrets/wealth_trade_map_key}"
export PATH="/home/box/.local/node22/bin:$PATH"
WR=/workspace/second-brain-site/worker/node_modules/.bin/wrangler
umask 077
if [ ! -s "$KEY_FILE" ]; then
  node -e 'const c="abcdefghjkmnpqrstuvwxyz23456789";const b=require("crypto").randomBytes(16);let s="";for(let i=0;i<16;i++){s+=c[b[i]%c.length];if(i%4==3&&i<15)s+="-"}process.stdout.write(s)' > "$KEY_FILE"
  chmod 600 "$KEY_FILE"; echo "New passphrase saved to $KEY_FILE"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < /home/box/.secrets/cf_api_token)"; export CLOUDFLARE_API_TOKEN; fi
cd "$ROOT/worker"
"$WR" deploy 2>&1 | tail -6
tr -d '\r\n' < "$KEY_FILE" | "$WR" secret put APP_KEY 2>&1 | tail -2
echo "Passphrase is in $KEY_FILE (not printed)."
