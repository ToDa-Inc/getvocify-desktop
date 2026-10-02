#!/bin/bash
# Builds Vocify.app: native shell + the dashboard, pointed at the production API.
#   GETVOCIFY_ROOT   dashboard repo (default ~/getvocify)
#   GETVOCIFY_REF    dashboard branch/commit to bundle (default staging).
#                    Built from a separate worktree, so the branch checked out in
#                    GETVOCIFY_ROOT never changes what ships. Set to "" to bundle
#                    GETVOCIFY_ROOT's working tree as-is (local dashboard work).
#   VOCIFY_API_URL   API the embedded dashboard talks to (default production)
#   VOCIFY_LIVE_API_URL  live transcription service (default: the API itself)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"
getvocify="${GETVOCIFY_ROOT:-$HOME/getvocify}"
dashboard_ref="${GETVOCIFY_REF-staging}"
api_url="${VOCIFY_API_URL:-https://api.getvocify.com/api/v1}"
# The live transcription service (app.live_main), apart from the API. Empty: the API serves it.
live_api_url="${VOCIFY_LIVE_API_URL:-}"
sources="$root/Sources/VocifyCompanion"
cd "$root"

if [[ ! -f "$getvocify/package.json" ]]; then
  echo "Dashboard repo not found at $getvocify (set GETVOCIFY_ROOT)." >&2
  exit 1
fi

# The native bridge only pairs with a dashboard that has the desktop meeting recorder.
required_dashboard_files=(
  src/features/desktop/DesktopMeetingProvider.tsx
  src/features/desktop/MeetingLiveView.tsx
  src/lib/meeting-transcript.ts
)

dashboard="$getvocify"
if [[ -n "$dashboard_ref" ]]; then
  if ! git -C "$getvocify" rev-parse --verify --quiet "$dashboard_ref^{commit}" >/dev/null; then
    echo "Dashboard ref \"$dashboard_ref\" not found in $getvocify (set GETVOCIFY_REF)." >&2
    exit 1
  fi
  target_commit="$(git -C "$getvocify" rev-parse "$dashboard_ref^{commit}")"
  current_commit="$(git -C "$getvocify" rev-parse HEAD)"
  if [[ "$current_commit" == "$target_commit" ]]; then
    dashboard="$getvocify"
  else
  dashboard="${VOCIFY_DASHBOARD_WORKTREE:-$HOME/.vocify-build/dashboard}"
  if [[ ! -e "$dashboard/.git" ]]; then
    mkdir -p "$(dirname "$dashboard")"
    git -C "$getvocify" worktree add --detach "$dashboard" "$dashboard_ref" >/dev/null
  else
    git -C "$dashboard" checkout --quiet --detach "$dashboard_ref"
  fi
  fi
  # Reuse the main checkout's packages when the lockfile matches; otherwise install.
  if [[ ! -e "$dashboard/node_modules" ]]; then
    if cmp -s "$dashboard/package-lock.json" "$getvocify/package-lock.json" && [[ -d "$getvocify/node_modules" ]]; then
      ln -s "$getvocify/node_modules" "$dashboard/node_modules"
    else
      (cd "$dashboard" && npm ci --no-audit --no-fund)
    fi
  fi
fi

for file in "${required_dashboard_files[@]}"; do
  if [[ ! -f "$dashboard/$file" ]]; then
    echo "❌ Dashboard at $dashboard (${dashboard_ref:-working tree}) has no $file." >&2
    echo "   This build would ship without the meeting recorder. Set GETVOCIFY_REF to the recorder branch." >&2
    exit 1
  fi
done
dashboard_commit="$(git -C "$dashboard" rev-parse --short HEAD)"
if [[ -z "$dashboard_ref" ]] && [[ -n "$(git -C "$dashboard" status --porcelain)" ]]; then
  dashboard_commit="$dashboard_commit-dirty"
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
echo "Building dashboard ${dashboard_ref:-working tree} @ $dashboard_commit against $api_url …"
(cd "$dashboard" && VITE_API_URL="$api_url" VITE_LIVE_API_URL="$live_api_url" npx vite build --outDir "$web_stage" --emptyOutDir --logLevel warn)

app="$root/Vocify.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$root/.build/release/VocifyCompanion" "$app/Contents/MacOS/Vocify"
cp "$root/Info.plist" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :VocifyDashboardCommit string $dashboard_commit" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :VocifyAPIURL string $api_url" "$app/Contents/Info.plist"
cp "$root/build/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$sources/Resources/icon.png" "$app/Contents/Resources/icon.png"
cp "$sources/bridge.js" "$app/Contents/Resources/bridge.js"
rsync -a --delete --exclude '.DS_Store' "$web_stage/" "$app/Contents/Resources/web/"

if [[ "${VOCIFY_DEV_SIGN:-}" == "1" ]]; then
  entitlements="$root/entitlements/development.plist"
else
  entitlements="$root/entitlements/distribution.plist"
fi
if [[ ! -f "$entitlements" ]]; then
  echo "Missing entitlements: $entitlements" >&2
  exit 1
fi
# shellcheck source=../../scripts/lib/signing-ids.sh
source "$repo/scripts/lib/signing-ids.sh"

requested="${CODESIGN_IDENTITY:-}"
sign_ref=""
if ! sign_ref="$(resolve_codesign_ref "$requested")"; then
  if [[ -n "$requested" ]]; then
    echo "" >&2
    echo "❌ CODESIGN_IDENTITY=\"$requested\" is not in your keychain." >&2
    echo "   Check: bash \"$repo/scripts/ensure-dev-signing.sh\"" >&2
    echo "" >&2
    exit 1
  fi
fi

if [[ -n "$sign_ref" ]]; then
  label="${requested:-$(list_signing_id_names | head -1)}"
  echo "Signing with: ${label:-$sign_ref} ($sign_ref)" >&2
  codesign --force --deep --options runtime --entitlements "$entitlements" --sign "$sign_ref" "$app"
else
  codesign --force --sign - "$app"
  echo "" >&2
  echo "⚠️  UNSIGNED (ad-hoc) build." >&2
  echo "    macOS will NOT list Vocify in Screen & System Audio Recording." >&2
  echo "    Fix: bash scripts/ensure-dev-signing.sh" >&2
  echo "    Then: CODESIGN_IDENTITY=\"Your Cert Name\" ./scripts/dev-desktop.sh" >&2
  echo "" >&2
fi

echo "$app"
