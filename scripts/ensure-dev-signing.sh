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
echo "Permissions still work via macOS prompts. For system audio to stick across"
echo "rebuilds, sign the app — easiest path: open apps/macos in Xcode, select the"
echo "Vocify target, Signing & Capabilities → Team → your Apple ID (free)."
echo ""
echo "Or create a Code Signing certificate in Keychain Access (Certificate Assistant)."
echo "Then: CODESIGN_IDENTITY=\"Your Cert Name\" $repo/scripts/dev-desktop.sh"
