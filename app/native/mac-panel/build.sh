#!/bin/bash
# Builds mac_panel.node for Electron, for Apple Silicon and Intel, into dist/mac_panel.node (one universal file).
set -euo pipefail
cd "$(dirname "$0")"
ELECTRON_VERSION="$(node -p "require('../../package.json').devDependencies.electron.replace(/^[^0-9]*/, '')")"
rm -rf dist build-*
mkdir -p dist
for arch in arm64 x64; do
  npx --yes node-gyp@11 rebuild --target="$ELECTRON_VERSION" --arch="$arch" --dist-url=https://electronjs.org/headers >/dev/null
  mv build "build-$arch"
done
lipo -create build-arm64/Release/mac_panel.node build-x64/Release/mac_panel.node -output dist/mac_panel.node
rm -rf build-arm64 build-x64
if [ -n "${CODESIGN_IDENTITY:-}" ]; then codesign --force --options runtime --sign "$CODESIGN_IDENTITY" dist/mac_panel.node; else codesign --force --sign - dist/mac_panel.node; fi
file dist/mac_panel.node
