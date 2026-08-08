#!/bin/bash
set -e -o pipefail

function cleanup {
  rm -rf build
  rm AppleDevIDApp.p12
  security delete-keychain percy.keychain
}

brew install gnu-sed
# vercel/pkg is archived; its final release (5.8.1) ships no Node 22 base
# binary, so it cannot build this CLI once the toolchain moves off Node 14.
# @yao-pkg/pkg is the maintained fork; its pkg-fetch v3.6 provides prebuilt
# Node 22 binaries for linux, macos and win on both x64 and arm64.
npm install -g @yao-pkg/pkg@6.22.0

yarn install
yarn build

# Remove type from package.json files
gsed -i '/"type": "module",/{s///;h};${x;/./{x;q0};x;q1}' ./package.json

# Create array of package.json files
array=($(ls -d ./packages/*/package.json))

# Delete package.json filepath where type module is not defined
delete=(./packages/dom/package.json ./packages/sdk-utils/package.json)
for del in ${delete[@]}
do
   array=("${array[@]/$del}")
done

# Remove type module from package.json where present
for package in "${array[@]}"
do
  if [ ! -z "$package" ]
  then
    gsed -i '/"type": "module",/{s///;h};${x;/./{x;q0};x;q1}' $package
  fi
done

echo "import { cli } from '@percy/cli';\
$(cat ./packages/cli/dist/percy.js)" > ./packages/cli/dist/percy.js

gsed -i '/Update NODE_ENV for executable/{s//\nprocess.env.NODE_ENV = "executable";/;h};${x;/./{x;q0};x;q1}' ./packages/cli/bin/run.cjs

# Convert ES6 code to cjs
npm run build_cjs
cp -R ./build/* packages/

# Create executables. (No `-d`/`--debug`: it only adds per-file "included as
# DISCLOSED code / asset content" logging — thousands of lines — without
# changing the output binaries.)
#
# Targets are pinned explicitly. Unpinned, pkg infers them from the host, so a
# macOS arm64 runner would silently start emitting an arm64 `percy-osx` — a
# change to what customers download, which is not this migration's call to make.
# Keep the published matrix at x64 and move only the embedded Node to 22;
# whether to add arm64 assets is a separate release decision.
pkg --targets node22-linux-x64,node22-macos-x64,node22-win-x64 ./packages/cli/bin/run.js

# Rename executables
mv run-linux percy && chmod +x percy
mv run-macos percy-osx && chmod +x percy-osx
mv run-win.exe percy.exe && chmod +x percy.exe

# Sign, notarize and package the assets only when the Apple signing secrets are
# present. Pull-request builds run without secrets: there we only want to prove
# the executables build and run (the verify step), not sign or ship them.
if [ -n "${APPLE_DEV_CERT:-}" ]; then
  # Sign & Notrize mac app
  echo "$APPLE_DEV_CERT" | base64 -d > AppleDevIDApp.p12

  security create-keychain -p percy percy.keychain
  security import AppleDevIDApp.p12 -t agg -k percy.keychain -P $APPLE_CERT_KEY -A
  security list-keychains -s ~/Library/Keychains/percy.keychain
  security default-keychain -s ~/Library/Keychains/percy.keychain
  security unlock-keychain -p "percy" ~/Library/Keychains/percy.keychain
  security set-keychain-settings -t 3600 -l ~/Library/Keychains/percy.keychain
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k percy ~/Library/Keychains/percy.keychain-db

  codesign  --force --verbose=4 -s "Developer ID Application: BrowserStack Inc ($APPLE_TEAM_ID)" --options runtime --entitlements scripts/files/entitlement.plist --keychain ~/Library/Keychains/percy.keychain percy-osx

  # Create zip file for uploading as assets
  zip percy-linux.zip percy
  mv percy-osx percy
  zip percy-osx.zip percy

  # NOTE: `@env:VAR` is altool syntax — notarytool does NOT support it and
  # treats the string as the literal password, so every submission 401s
  # (this broke the v1.32.3 release). Pass the expanded value instead; argv
  # visibility (CWE-214) is a non-issue on an ephemeral single-tenant runner,
  # and GitHub masks the secret in logs. For stronger hardening later, use an
  # App Store Connect API key (--key/--key-id/--issuer) or --keychain-profile.
  xcrun notarytool submit --apple-id "$APPLE_ID_USERNAME" --password "$APPLE_ID_KEY" --team-id "$APPLE_TEAM_ID" percy-osx.zip --wait

  cleanup
else
  echo "APPLE_DEV_CERT not set — skipping macOS signing/notarization (PR build)."
  # Leave ./percy as the macOS binary so the verify step runs natively on the
  # macOS runner (mirrors the signed path, which ends with percy == percy-osx).
  mv percy-osx percy
fi
