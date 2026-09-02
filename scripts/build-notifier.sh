#!/usr/bin/env bash

# Builds the macOS notification helper into dist/pr-stats.app. The TUI
# spawns the binary inside the bundle to post desktop notifications under
# the pr-stats name and icon instead of Script Editor's, see
# native/macos/main.swift for the why. The script compiles the helper for
# arm64 and x86_64 and joins the slices into one universal binary, renders
# the icon set from native/macos/icon.png, assembles the bundle, stamps
# the package version into the Info.plist, and ad-hoc signs the result.
# Ad-hoc signing is enough because npm never sets the quarantine attribute
# on the files it extracts, so Gatekeeper leaves the bundle alone. The
# helper only builds on macOS and needs the Xcode command line tools, and
# the publish workflow runs it on a macOS runner.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-notifier: the notification helper only builds on macOS" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root/native/macos"
bundle="$root/dist/pr-stats.app"
work="$(mktemp -d)"

trap 'rm -rf "$work"' EXIT

bundle_id="dev.d3lm.pr-stats.notifier"
executable="pr-stats-notifier"
min_macos="13.0"
version="$(node -p "require('$root/package.json').version")"

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos$min_macos" -o "$work/$arch" "$source_dir/main.swift"
done

lipo -create "$work/arm64" "$work/x86_64" -output "$work/$executable"

iconset="$work/AppIcon.iconset"

mkdir -p "$iconset"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$source_dir/icon.png" --out "$iconset/icon_${size}x${size}.png" > /dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$source_dir/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" > /dev/null
done

iconutil -c icns "$iconset" -o "$work/AppIcon.icns"

rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"

cp "$work/$executable" "$bundle/Contents/MacOS/$executable"
cp "$work/AppIcon.icns" "$bundle/Contents/Resources/AppIcon.icns"
cp "$source_dir/Info.plist" "$bundle/Contents/Info.plist"

/usr/libexec/PlistBuddy \
  -c "Set :CFBundleShortVersionString $version" \
  -c "Set :CFBundleVersion $version" \
  "$bundle/Contents/Info.plist"

codesign --force --sign - --identifier "$bundle_id" "$bundle"

echo "built $bundle ($version, $(lipo -archs "$bundle/Contents/MacOS/$executable"))"
