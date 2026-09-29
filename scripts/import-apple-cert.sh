#!/usr/bin/env bash
# Import a Developer ID certificate (.p12) into a CI keychain.
# Requires: APPLE_CERTIFICATE_BASE64, APPLE_CERTIFICATE_PASSWORD
# No-ops when APPLE_CERTIFICATE_BASE64 is unset (unsigned CI builds).
set -euo pipefail

cert_b64="${APPLE_CERTIFICATE_BASE64:-}"
if [[ -z "$cert_b64" ]]; then
  echo "No APPLE_CERTIFICATE_BASE64 — skipping certificate import (unsigned build)."
  exit 0
fi

cert_pass="${APPLE_CERTIFICATE_PASSWORD:?Set APPLE_CERTIFICATE_PASSWORD when APPLE_CERTIFICATE_BASE64 is set}"
keychain="${RUNNER_TEMP:-/tmp}/vocify-signing.keychain-db"
keychain_pass="${KEYCHAIN_PASSWORD:-vocify-ci}"

security create-keychain -p "$keychain_pass" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_pass" "$keychain"

p12="$(mktemp).p12"
echo "$cert_b64" | base64 --decode > "$p12"
security import "$p12" -k "$keychain" -P "$cert_pass" \
  -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/security
rm -f "$p12"

security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_pass" "$keychain"
security list-keychains -d user -s "$keychain" "$(security list-keychains -d user | tr -d '"')"

security find-identity -v -p codesigning "$keychain"
