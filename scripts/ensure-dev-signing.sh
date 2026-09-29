#!/usr/bin/env bash
# Optional: list local code signing identities for dev builds.
# macOS ties Screen & System Audio Recording to a stable app signature — ad-hoc
# builds (`codesign -s -`) get a new identity every compile.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/signing-ids.sh
source "$repo/scripts/lib/signing-ids.sh"

echo "=== Vocify code signing (optional for local dev) ==="
echo ""

ids="$(list_signing_id_names)"
if [[ -n "$ids" ]]; then
  echo "Found signing identities:"
  security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^[[:space:]]*[0-9]/&/p'
  echo ""
  echo "Rebuild signed:"
  first="$(echo "$ids" | head -1)"
  echo "  CODESIGN_IDENTITY=\"$first\" $repo/scripts/dev-desktop.sh"
  exit 0
fi

echo "No signing identity in Keychain."
echo ""
echo "Create one for local/team builds:"
echo "  bash $repo/scripts/create-dev-signing-cert.sh"
echo ""
echo "Then rebuild:"
echo "  CODESIGN_IDENTITY=\"Vocify Dev\" $repo/scripts/dev-desktop.sh"
