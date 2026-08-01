#!/usr/bin/env bash
# Top up the Groupie queue on demand (the daily cron does this automatically).
# Usage: bash topup.sh [days]   — default 30
set -euo pipefail
cd "$(dirname "$0")"

DAYS="${1:-30}"
URL="https://groupie.fun"

[ -f .admin-token ] || { echo "No .admin-token file — run setup-deploy.sh first."; exit 1; }

curl -s -X POST "$URL/api/generate" \
  -H "Authorization: Bearer $(cat .admin-token)" \
  -H "Content-Type: application/json" \
  -d "{\"days\": $DAYS}"
echo ""
curl -s "$URL/api/health"
echo ""
