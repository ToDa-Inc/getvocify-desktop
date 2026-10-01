#!/usr/bin/env bash
# Shared helpers for parsing `security find-identity -v -p codesigning` output.
list_signing_id_names() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/^[[:space:]]*[0-9][0-9]*)[[:space:]]*[A-F0-9][A-F0-9]*[[:space:]]*"\(.*\)"/\1/p' || true
}

signing_id_hashes_for_name() {
  local name="$1"
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n "s/^[[:space:]]*[0-9][0-9]*)[[:space:]]*\\([A-F0-9][A-F0-9]*\\)[[:space:]]*\"${name//\//\\/}\"/\1/p" \
    | sort -u
}

# Certificate that signed the installed app, so a rebuild keeps its Microphone and
# Screen Recording grants (macOS ties them to the certificate, not the name).
installed_app_signing_hash() {
  codesign -d -r- /Applications/Vocify.app 2>&1 \
    | sed -n 's/.*certificate leaf = H"\([a-fA-F0-9]*\)".*/\1/p' \
    | tr '[:lower:]' '[:upper:]'
}

# Several certificates can share a name; `find-identity` lists them in no fixed
# order, so picking "the first" flipped between them and re-triggered permission prompts.
signing_id_hash_for_name() {
  local name="$1"
  local hashes installed
  hashes="$(signing_id_hashes_for_name "$name")"
  if [[ "$(printf '%s\n' "$hashes" | grep -c .)" -gt 1 ]]; then
    installed="$(installed_app_signing_hash)"
    if [[ -n "$installed" ]] && printf '%s\n' "$hashes" | grep -qx "$installed"; then
      echo "$installed"
      return
    fi
    echo "⚠️  Several \"$name\" certificates in your keychain; using the first by hash. Delete the extras in Keychain Access." >&2
  fi
  printf '%s\n' "$hashes" | head -1
}

first_signing_id_hash() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/^[[:space:]]*[0-9][0-9]*)[[:space:]]*\([A-F0-9][A-F0-9]*\)[[:space:]]*".*"/\1/p' \
    | head -1
}

has_signing_id() {
  local name="$1"
  [[ -n "$(signing_id_hash_for_name "$name")" ]]
}

# Returns a codesign -s argument (SHA-1 hash avoids duplicate-name ambiguity).
resolve_codesign_ref() {
  local requested="${1:-}"
  local hash=""
  if [[ "$requested" =~ ^[A-Fa-f0-9]{40}$ ]]; then
    hash="$(echo "$requested" | tr '[:lower:]' '[:upper:]')"
    security find-identity -v -p codesigning 2>/dev/null | grep -q "$hash" || return 1
  elif [[ -n "$requested" ]]; then
    hash="$(signing_id_hash_for_name "$requested")"
    if [[ -z "$hash" ]]; then
      return 1
    fi
  else
    hash="$(first_signing_id_hash)"
    if [[ -z "$hash" ]]; then
      return 1
    fi
  fi
  echo "$hash"
}
