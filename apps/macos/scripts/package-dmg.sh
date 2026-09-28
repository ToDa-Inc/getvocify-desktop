#!/bin/bash
# Packages the app from build-app.sh into dist/Vocify-macos.dmg.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"

app="$(bash "$root/scripts/build-app.sh" | tail -n 1)"

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
echo "$dmg"
