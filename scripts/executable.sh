#!/bin/bash
set -e -o pipefail

function cleanup {
  rm -rf build
  rm AppleDevIDApp.p12
  security delete-keychain percy.keychain
}

brew install gnu-sed
# @yao-pkg/pkg is the maintained fork. vercel/pkg is archived at 5.8.1 and fails
# with "No available node version satisfies 'node20'". Pinned deliberately: an
# unversioned global install here lets the registry decide what compiles the
# binaries customers download.
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
# Targets are explicit on purpose, for two separate reasons.
#
# ARCH: pkg defaults to linux,macos,win at the HOST arch, so on an arm64 runner it
# silently emits arm64 binaries for every x64 customer -- and `--version` passes on
# the arm64 runner that built them. verify-executable.sh now asserts x86-64 too.
#
# NODE VERSION: node22, not node20. This is the runtime compiled INTO the binary,
# which is our choice and independent of the `engines` floor the packages declare.
# `node20` fails outright -- @yao-pkg/pkg resolves that range to a patch with no
# prebuilt in pkg-fetch, so the fetch 404s and it refuses to cross-compile:
#     Error! 404: Not Found / Not found in remote cache:
#     Error! Not able to build for 'linux' here, only for 'macos'
# node22 is the fork's documented primary target, and unlike Node 20 (EOL
# 30 Apr 2026) it still receives security releases -- which matters most here,
# because binary users cannot patch the runtime we ship them.
pkg ./packages/cli/bin/run.js \
  --targets node22-linux-x64,node22-macos-x64,node22-win-x64

# Rename executables
# pkg names outputs `<entry>-<platform>` when the target arch equals the host
# arch and `<entry>-<platform>-<arch>` otherwise, so match by prefix.
mv "$(ls run-linux* | head -1)" percy && chmod +x percy
mv "$(ls run-macos* | head -1)" percy-osx && chmod +x percy-osx
mv "$(ls run-win*.exe | head -1)" percy.exe && chmod +x percy.exe

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
