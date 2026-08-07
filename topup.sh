#!/usr/bin/env bash
# Top up the Groupie queue on demand (the daily cron does this automatically).
# Each round asks the server to generate AT MOST ONE missing day (a day costs
# two model calls, so bigger batches get cut off by Cloudflare's edge).
# Usage: bash topup.sh [rounds]   — default 12 rounds
set -euo pipefail
cd "$(dirname "$0")"

ROUNDS="${1:-12}"
URL="https://groupie.fun"

[ -f .admin-token ] || { echo "No .admin-token file — run setup-deploy.sh first."; exit 1; }

for i in $(seq 1 "$ROUNDS"); do
  printf 'round %s/%s: ' "$i" "$ROUNDS"
  curl -s --max-time 180 -X POST "$URL/api/generate" \
    -H "Authorization: Bearer $(cat .admin-token)" \
    -H "Content-Type: application/json" \
    -d '{"days": 45}' || printf 'request failed (safe to ignore, next round retries)'
  echo ""
done
echo ""
curl -s "$URL/api/health"
echo ""
