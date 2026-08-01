#!/usr/bin/env bash
# Redeploy Groupie after a code change. Run: bash redeploy.sh
set -euo pipefail
cd "$(dirname "$0")"
npx wrangler deploy
echo ""
echo "Deployed. Health:"
curl -s "https://groupie.fun/api/health" || true
echo ""
