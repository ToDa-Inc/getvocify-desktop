#!/bin/bash
# Packages the app from build-app.sh into dist/Vocify-macos.dmg.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"

build_log="$(mktemp)"
if ! bash "$root/scripts/build-app.sh" 2>&1 | tee "$build_log"; then
  rm -f "$build_log"
  exit 1
fi
app="$(tail -n 1 "$build_log")"
rm -f "$build_log"

bg="$root/build/dmg-background.png"
swift "$root/scripts/draw-dmg-background.swift" "$repo/brand/icon-512.png" "$bg"

stage="$(mktemp -d)"
cp -R "$app" "$stage/Vocify.app"
ln -s /Applications "$stage/Applications"
mkdir -p "$stage/.background"
cp "$bg" "$stage/.background/background.png"

mkdir -p "$repo/dist"
dmg="$repo/dist/Vocify-macos.dmg"
rm -f "$dmg"
hdiutil create -volname "Vocify" -srcfolder "$stage" -ov -format UDZO "$dmg" >/dev/null
rm -rf "$stage"

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  # shellcheck source=../../scripts/lib/signing-ids.sh
  source "$repo/scripts/lib/signing-ids.sh"
  if sign_ref="$(resolve_codesign_ref "$CODESIGN_IDENTITY")"; then
    echo "Signing DMG with: $CODESIGN_IDENTITY ($sign_ref)" >&2
    codesign --force --sign "$sign_ref" "$dmg"
  fi
fi

if [[ "${NOTARIZE:-}" == "1" ]]; then
  bash "$repo/scripts/notarize-dmg.sh" "$dmg"
fi

echo "$dmg"
