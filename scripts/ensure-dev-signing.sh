#!/usr/bin/env bash
# macOS TCC requires a stable code signature (Apple TN3127). Ad-hoc (`codesign -s -`)
# changes every build and the app never appears in Privacy settings.
set -euo pipefail

echo "=== Vocify code signing check ==="
echo ""
ids="$(security find-identity -v -p codesigning 2>/dev/null \
  | sed -n 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*[A-F0-9][A-F0-9]*[[:space:]]*"\(.*\)"/\1/p' || true)"

if [[ -n "$ids" ]]; then
  echo "Found signing identities:"
  security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^[[:space:]]*[0-9]/&/p'
  echo ""
  echo "Rebuild with:"
  first="$(echo "$ids" | head -1)"
  echo "  CODESIGN_IDENTITY=\"$first\" ./scripts/dev-desktop.sh"
  exit 0
fi

echo "No code signing identity found."
echo ""
echo "Create one (free, local, ~2 minutes):"
echo "  1. Open Keychain Access"
echo "  2. Keychain Access menu → Certificate Assistant → Create a Certificate…"
echo "  3. Name: Vocify Dev"
echo "  4. Identity type: Self Signed Root"
echo "  5. Certificate Type: Code Signing → Continue → Create"
echo "  6. Re-run this script, then rebuild:"
echo "       CODESIGN_IDENTITY=\"Vocify Dev\" ./scripts/dev-desktop.sh"
echo ""
echo "Or use an Apple Development certificate from developer.apple.com (free account)."
echo ""
echo "After a signed build, Vocify will appear in:"
echo "  System Settings → Privacy & Security → Screen & System Audio Recording"
