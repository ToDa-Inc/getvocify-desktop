#!/bin/bash
set -euo pipefail

# Build script for vocify-mac-helper
# Builds a universal (arm64 + x86_64) release binary

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
BUILD_DIR="$SCRIPT_DIR/.build"

# Create dist directory
mkdir -p "$DIST_DIR"

echo "Building vocify-mac-helper (universal)..."

# Build for arm64
echo "  Building for arm64..."
swift build \
    -c release \
    --arch arm64 \
    --package-path "$SCRIPT_DIR" \
    --build-path "$BUILD_DIR-arm64"

# Build for x86_64
echo "  Building for x86_64..."
swift build \
    -c release \
    --arch x86_64 \
    --package-path "$SCRIPT_DIR" \
    --build-path "$BUILD_DIR-x86_64"

# Create universal binary
echo "  Creating universal binary..."
lipo -create \
    "$BUILD_DIR-arm64/release/vocify-mac-helper" \
    "$BUILD_DIR-x86_64/release/vocify-mac-helper" \
    -output "$DIST_DIR/vocify-mac-helper"

# Sign the binary
echo "  Code signing..."
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
if [ "$CODESIGN_IDENTITY" = "-" ]; then
    codesign -s - "$DIST_DIR/vocify-mac-helper"
else
    codesign -s "$CODESIGN_IDENTITY" --options runtime "$DIST_DIR/vocify-mac-helper"
fi

# Make executable
chmod +x "$DIST_DIR/vocify-mac-helper"

echo "✓ Built: $DIST_DIR/vocify-mac-helper"
file "$DIST_DIR/vocify-mac-helper"

# Clean up build directories
rm -rf "$BUILD_DIR-arm64" "$BUILD_DIR-x86_64"
