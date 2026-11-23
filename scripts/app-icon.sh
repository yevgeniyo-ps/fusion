#!/bin/bash
# Compiles the app icon (src-tauri/icons/AppIcon.icon, an Icon Composer file) with Xcode's
# actool, into what the bundle ships:
#   src-tauri/icons/Assets.car  the macOS 26 icon (CFBundleIconName in src-tauri/Info.plist)
#   src-tauri/icons/icon.icns   the icon for macOS before 26
# macOS 26 puts an app icon that comes only as .icns on a white plate. Run this after a
# change to AppIcon.icon; it needs Xcode 26 (not only the Command Line Tools).
set -euo pipefail
cd "$(dirname "$0")/../src-tauri/icons"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# actool needs an absolute path to the .icon.
xcrun actool "$PWD/AppIcon.icon" --compile "$out" --platform macosx --minimum-deployment-target 13.0 \
  --app-icon AppIcon --target-device mac --output-partial-info-plist "$out/partial.plist" >/dev/null
cp "$out/Assets.car" Assets.car
cp "$out/AppIcon.icns" icon.icns
echo "icons: Assets.car and icon.icns from AppIcon.icon"
