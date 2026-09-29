#!/usr/bin/env bash
# Submit a DMG to Apple notarization and staple the ticket.
# Requires: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
set -euo pipefail

dmg="${1:?usage: notarize-dmg.sh path/to/Vocify-macos.dmg}"
apple_id="${APPLE_ID:?Set APPLE_ID}"
app_password="${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD}"
team_id="${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"

if [[ ! -f "$dmg" ]]; then
  echo "DMG not found: $dmg" >&2
  exit 1
fi

echo "Submitting $(basename "$dmg") for notarization …"
xcrun notarytool submit "$dmg" \
  --apple-id "$apple_id" \
  --password "$app_password" \
  --team-id "$team_id" \
  --wait

echo "Stapling notarization ticket …"
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
echo "Notarized: $dmg"
