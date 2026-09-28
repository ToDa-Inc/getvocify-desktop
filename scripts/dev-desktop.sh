#!/usr/bin/env bash
# Rebuild Vocify.app with the dashboard from ~/getvocify and open it.
# Usage:
#   ./scripts/dev-desktop.sh          # production API
#   ./scripts/dev-desktop.sh staging  # staging API
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
getvocify="${GETVOCIFY_ROOT:-$HOME/getvocify}"
profile="${1:-prod}"

case "$profile" in
  staging)
    export VOCIFY_API_URL="${VOCIFY_API_URL:-https://staging-api.getvocify.com/api/v1}"
    ;;
  prod|production)
    export VOCIFY_API_URL="${VOCIFY_API_URL:-https://api.getvocify.com/api/v1}"
    ;;
  *)
    echo "Unknown profile: $profile (use prod or staging)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$getvocify/package.json" ]]; then
  echo "Dashboard repo not found at $getvocify" >&2
  echo "Clone it or set GETVOCIFY_ROOT=/path/to/getvocify" >&2
  exit 1
fi

echo "→ Dashboard: $getvocify"
echo "→ API:       $VOCIFY_API_URL"
echo "→ Building Vocify.app …"

cd "$repo/apps/macos"
bash scripts/build-app.sh

app="$repo/apps/macos/Vocify.app"
echo ""
echo "Built $app"
echo ""

if codesign -dv "$app" 2>&1 | grep -q 'Signature=adhoc'; then
  echo "⚠️  UNSIGNED build — System Settings will NOT list Vocify for system audio."
  echo "    Run: bash scripts/ensure-dev-signing.sh"
  echo "    Then: CODESIGN_IDENTITY=\"Vocify Dev\" ./scripts/dev-desktop.sh"
  echo ""
else
  echo "Before testing:"
  echo "  • Quit any running Vocify first (⌘Q)"
  echo "  • On Record: Allow mic + system audio (drag Vocify into Settings if prompted)"
  echo "  • After enabling system audio: ⌘Q and reopen once"
  echo ""
fi

if [[ "${OPEN_APP:-1}" != "0" ]]; then
  open "$app"
fi
