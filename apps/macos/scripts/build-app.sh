#!/bin/bash
# Builds Vocify.app: native shell + the dashboard from ~/getvocify, pointed at the production API.
#   GETVOCIFY_ROOT   dashboard repo (default ~/getvocify)
#   VOCIFY_API_URL   API the embedded dashboard talks to (default production)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"
getvocify="${GETVOCIFY_ROOT:-$HOME/getvocify}"
api_url="${VOCIFY_API_URL:-https://api.getvocify.com/api/v1}"
sources="$root/Sources/VocifyCompanion"
cd "$root"

if [[ ! -f "$getvocify/package.json" ]]; then
  echo "Dashboard repo not found at $getvocify (set GETVOCIFY_ROOT)." >&2
  exit 1
fi

swift build -c release

iconset="$root/build/AppIcon.iconset"
if [[ ! -f "$root/build/AppIcon.icns" ]]; then
  mkdir -p "$iconset"
  src="$repo/brand/icon-512.png"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$src" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  done
  sips -z 32 32 "$src" --out "$iconset/icon_16x16@2x.png" >/dev/null
  sips -z 64 64 "$src" --out "$iconset/icon_32x32@2x.png" >/dev/null
  sips -z 256 256 "$src" --out "$iconset/icon_128x128@2x.png" >/dev/null
  sips -z 512 512 "$src" --out "$iconset/icon_256x256@2x.png" >/dev/null
  cp "$src" "$iconset/icon_512x512@2x.png"
  iconutil -c icns "$iconset" -o "$root/build/AppIcon.icns"
fi

web_stage="$root/build/web"
echo "Building dashboard from $getvocify against $api_url …"
(cd "$getvocify" && VITE_API_URL="$api_url" npx vite build --outDir "$web_stage" --emptyOutDir --logLevel warn)

app="$root/Vocify.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/companion"
cp "$root/.build/release/VocifyCompanion" "$app/Contents/MacOS/VocifyCompanion"
cp "$root/Info.plist" "$app/Contents/Info.plist"
cp "$root/build/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$sources/Resources/icon.png" "$app/Contents/Resources/icon.png"
cp "$sources/bridge.js" "$app/Contents/Resources/bridge.js"
cp "$sources/Resources/companion/overlay.html" "$app/Contents/Resources/companion/overlay.html"
rsync -a --delete --exclude '.DS_Store' "$web_stage/" "$app/Contents/Resources/web/"
codesign --force --sign - "$app"
echo "$app"
