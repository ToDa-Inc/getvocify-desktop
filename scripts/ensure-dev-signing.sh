#!/usr/bin/env bash
# macOS TCC requires a stable code signature (Apple TN3127). Ad-hoc (`codesign -s -`)
# changes every build and the app never appears in Privacy settings.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/signing-ids.sh
source "$repo/scripts/lib/signing-ids.sh"

NAME="${VOCIFY_DEV_CERT_NAME:-Vocify Dev}"

echo "=== Vocify code signing check ==="
echo ""

ids="$(list_signing_id_names)"
if [[ -n "$ids" ]]; then
  echo "Found signing identities:"
  security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^[[:space:]]*[0-9]/&/p'
  echo ""
  echo "Rebuild with:"
  first="$(echo "$ids" | head -1)"
  echo "  CODESIGN_IDENTITY=\"$first\" $repo/scripts/dev-desktop.sh"
  exit 0
fi

echo "No code signing identity found."
echo ""

if [[ "${1:-}" == "--create" ]]; then
  bash "$repo/scripts/create-dev-signing-cert.sh"
  exit $?
fi

echo "Create one automatically (recommended):"
echo "  bash $repo/scripts/create-dev-signing-cert.sh"
echo ""
echo "Or manually in Keychain Access:"
echo "  1. Keychain Access → Certificate Assistant → Create a Certificate…"
echo "  2. Name: $NAME | Identity: Self Signed Root | Type: Code Signing"
echo "  3. Open the cert → Trust → Code Signing → Always Trust"
echo "  4. Re-run: bash $repo/scripts/ensure-dev-signing.sh"
echo ""
echo "Then rebuild:"
echo "  CODESIGN_IDENTITY=\"$NAME\" $repo/scripts/dev-desktop.sh"
echo ""
echo "After a signed build, Vocify appears in:"
echo "  System Settings → Privacy & Security → Screen & System Audio Recording"
