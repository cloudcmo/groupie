#!/usr/bin/env bash
# First-time setup and deploy for Groupie. Run once: bash setup-deploy.sh
# Mirrors What Word's setup: D1 database, secrets, seed, deploy, fill the queue.
set -euo pipefail

cd "$(dirname "$0")"

echo "── Groupie: first deploy ──────────────────────────────────────"

command -v npx >/dev/null || { echo "Need Node/npm installed first."; exit 1; }

[ -d node_modules ] || npm install

# 1. Database ------------------------------------------------------------
if grep -q "PASTE_DATABASE_ID_HERE" wrangler.toml; then
  echo "Creating the D1 database…"
  OUT=$(npx wrangler d1 create groupie 2>&1) || { echo "$OUT"; exit 1; }
  DB_ID=$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$DB_ID" ] || { echo "Couldn't read the database id from wrangler's output:"; echo "$OUT"; exit 1; }
  sed -i.bak "s/PASTE_DATABASE_ID_HERE/$DB_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  database_id = $DB_ID written to wrangler.toml"
fi

echo "Applying the schema…"
npx wrangler d1 execute groupie --remote --file=schema.sql

echo "Seeding the five hand-set launch grids…"
npx wrangler d1 execute groupie --remote --file=seed.sql

# 2. Secrets -------------------------------------------------------------
echo ""
echo "Secrets (paste when prompted; leave RESEND blank to skip alerts/newsletter):"
npx wrangler secret put ANTHROPIC_API_KEY

if [ ! -f .admin-token ]; then
  LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 48 > .admin-token
  echo "  Generated .admin-token (kept out of git)."
fi
npx wrangler secret put ADMIN_TOKEN < .admin-token

read -r -p "Set RESEND_API_KEY now? [y/N] " yn
if [[ "${yn:-n}" =~ ^[Yy]$ ]]; then
  npx wrangler secret put RESEND_API_KEY
fi

# 3. Deploy --------------------------------------------------------------
echo ""
echo "Deploying…"
npx wrangler deploy

URL=$(npx wrangler deployments list 2>/dev/null | grep -oE 'https://[^ ]*workers.dev' | head -1 || true)
URL=${URL:-https://groupie.carl-b82.workers.dev}

# 4. Fill the queue ------------------------------------------------------
echo ""
echo "Filling the queue (30 days, in batches of 5 to stay inside limits)…"
for i in 1 2 3 4 5 6; do
  curl -s -X POST "$URL/api/generate" \
    -H "Authorization: Bearer $(cat .admin-token)" \
    -H "Content-Type: application/json" \
    -d '{"days": 30}' | head -c 400
  echo ""
done

echo ""
echo "Done. Check: $URL/api/health"
