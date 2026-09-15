#!/bin/sh
# Production deploy to the user's own Vercel project, once `npx vercel login`
# has been run on this machine. Links the folder to the named project, sets
# the four variables from files (never typed), and deploys to production.
#
#   sh vercel-prod.sh <project-name> <secrets-dir>
#
# Re-running is safe: `env add` is skipped for a variable that already exists.
cd "C:/Users/HI/Desktop/claude/session/ese" || exit 1
PROJECT="$1"
SEC="${2:-.secrets}"
[ -n "$PROJECT" ] && [ -d "$SEC" ] || { echo "usage: sh scripts/vercel-prod.sh <project-name> [secrets-dir]"; exit 2; }

npx --yes vercel link --yes --project "$PROJECT" || exit 1

have() { npx --yes vercel env ls production 2>/dev/null | grep -q "^ *$1 "; }
add() { # name value
  if have "$1"; then echo "env $1: present"; else printf '%s' "$2" | npx --yes vercel env add "$1" production && echo "env $1: added"; fi
}
add DATABASE_URL "$(tr -d '\r\n' < "$SEC/database.url")"
add ELOHIM_VOICE_ID "0UFPkz6r4cUaHBRHtegr"
add ELOHIM_VOICE_API_KEY "$(tr -d '\r\n' < "$SEC/elevenlabs.key")"
add ELOHIM_BLOB_KEY "$(grep -o '[0-9a-f]\{64\}' .secrets/production-blob-key.txt | head -1)"

exec npx --yes vercel deploy --prod --yes
