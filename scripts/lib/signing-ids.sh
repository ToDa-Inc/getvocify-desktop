#!/usr/bin/env bash
# Shared helpers for parsing `security find-identity -v -p codesigning` output.
list_signing_id_names() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/^[[:space:]]*[0-9][0-9]*)[[:space:]]*[A-F0-9][A-F0-9]*[[:space:]]*"\(.*\)"/\1/p' || true
}

signing_id_hash_for_name() {
  local name="$1"
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n "s/^[[:space:]]*[0-9][0-9]*)[[:space:]]*\\([A-F0-9][A-F0-9]*\\)[[:space:]]*\"${name//\//\\/}\"/\1/p" \
    | head -1
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
  if [[ -n "$requested" ]]; then
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
