#!/usr/bin/env bash
# Creates a local Code Signing identity for Vocify dev builds.
# macOS TCC requires a stable signature; ad-hoc builds cannot use Screen & System Audio Recording.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/signing-ids.sh
source "$repo/scripts/lib/signing-ids.sh"

NAME="${VOCIFY_DEV_CERT_NAME:-Vocify Dev}"
KEYCHAIN="${VOCIFY_DEV_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"
IMPORT_PASS="${VOCIFY_DEV_CERT_PASS:-vocify}"

if has_signing_id "$NAME"; then
  echo "Code signing identity already exists: $NAME"
  security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^[[:space:]]*[0-9]/&/p'
  exit 0
fi

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "Found certificate \"$NAME\" but it is not trusted for code signing yet."
  tmp="$(mktemp)"
  security find-certificate -c "$NAME" -p "$KEYCHAIN" > "$tmp"
  security add-trusted-cert -d -r trustRoot -p codeSign -k "$KEYCHAIN" "$tmp" >/dev/null 2>&1 \
    || security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$tmp"
  rm -f "$tmp"
  if has_signing_id "$NAME"; then
    echo "Trusted \"$NAME\" for code signing."
    security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^[[:space:]]*[0-9]/&/p'
    exit 0
  fi
  echo "Open Keychain Access → login → Certificates → \"$NAME\" → Trust → Code Signing: Always Trust." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required but not found." >&2
  exit 1
fi

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

cat > "$tmp/openssl.cnf" <<EOF
[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[ dn ]
CN = $NAME

[ v3_req ]
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
basicConstraints = critical,CA:false
EOF

echo "Creating self-signed Code Signing certificate: $NAME"
openssl req -x509 -newkey rsa:2048 \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" \
  -days 825 -nodes \
  -config "$tmp/openssl.cnf" -extensions v3_req >/dev/null 2>&1

openssl pkcs12 -export \
  -out "$tmp/identity.p12" \
  -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
  -passout "pass:$IMPORT_PASS" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1

security import "$tmp/identity.p12" -k "$KEYCHAIN" -P "$IMPORT_PASS" \
  -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/security

security add-trusted-cert -d -r trustRoot -p codeSign -k "$KEYCHAIN" "$tmp/cert.pem" >/dev/null 2>&1 \
  || security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$tmp/cert.pem"

if ! has_signing_id "$NAME"; then
  echo "" >&2
  echo "Certificate was imported but is not a valid signing identity yet." >&2
  echo "Open Keychain Access → login → Certificates → \"$NAME\" → Trust → Code Signing: Always Trust." >&2
  exit 1
fi

echo ""
echo "Ready. Rebuild with:"
echo "  CODESIGN_IDENTITY=\"$NAME\" $repo/scripts/dev-desktop.sh"
security find-identity -v -p codesigning 2>/dev/null | sed -n 's/^[[:space:]]*[0-9]/&/p'
