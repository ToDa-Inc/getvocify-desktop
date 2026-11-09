#!/bin/bash
# Installs Vocify for Mac from the newest release, or replaces an installed Vocify with it:
#
#   curl -fsSL https://raw.githubusercontent.com/ToDa-Inc/getvocify-desktop/main/scripts/install-mac.sh | bash
#
# Downloaded this way the app carries no quarantine flag, so macOS opens it without the "Open Anyway" step a browser
# download needs. After that the app updates itself.
set -euo pipefail

repo="ToDa-Inc/getvocify-desktop"
app="/Applications/Vocify.app"
# The team's "Vocify Dev" certificate: installed apps update only to builds signed with it.
leaf='certificate leaf = H"70d4242a077672091cf69a7c118a8671c0995d8f"'

if pgrep -xq Vocify; then
  echo "Vocify is open. Quit it first (menu bar icon → Quit Vocify), then run this again." >&2
  exit 1
fi
if [ ! -w /Applications ]; then
  echo "This Mac user can't add apps to /Applications. Run this from an administrator account." >&2
  exit 1
fi

echo "Looking for the newest Vocify for Mac…"
url="$(curl -fsSL "https://api.github.com/repos/$repo/releases?per_page=30" \
  | grep -o '"browser_download_url": *"[^"]*/Vocify-[^"]*-mac\.zip"' \
  | head -1 | sed 's/.*"\(https:[^"]*\)"$/\1/')"
if [ -z "$url" ]; then
  echo "No Mac build is published yet." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $(basename "$url")…"
curl -fL --progress-bar -o "$tmp/vocify.zip" "$url"
ditto -x -k "$tmp/vocify.zip" "$tmp/unzipped"

if ! codesign --verify --deep --strict "$tmp/unzipped/Vocify.app" 2>/dev/null \
  || ! codesign -d -r- "$tmp/unzipped/Vocify.app" 2>&1 | grep -q "$leaf"; then
  echo "The download isn't signed by Vocify. Nothing was installed." >&2
  exit 1
fi

rm -rf "$app"
ditto "$tmp/unzipped/Vocify.app" "$app"
xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
echo "Installed $(defaults read "$app/Contents/Info" CFBundleShortVersionString). Opening Vocify…"
open "$app"
