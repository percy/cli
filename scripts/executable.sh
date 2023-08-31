#!/bin/bash
set -e -o pipefail

function cleanup {
  rm -rf build
  rm AppleDevIDApp.p12
  rm notarize_config.json
  security delete-keychain percy.keychain
}

brew install gnu-sed
npm install -g pkg

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

# Create executables
pkg ./packages/cli/bin/run.js -d

# Rename executables
mkdir -p osx && mv run-macos percy && chmod +x percy
mkdir -p linux && mv run-linux percy-linux && chmod +x percy-linux
mkdir -p win && mv run-win.exe percy.exe && chmod +x percy.exe

# Sign & Notrize mac app
echo "$APPLE_DEV_CERT" | base64 -d > AppleDevIDApp.p12

security create-keychain -p percy percy.keychain
security import AppleDevIDApp.p12 -t agg -k percy.keychain -P ChaiTime -A
security list-keychains -s ~/Library/Keychains/percy.keychain
security default-keychain -s ~/Library/Keychains/percy.keychain
security unlock-keychain -p "percy" ~/Library/Keychains/percy.keychain
security set-keychain-settings -t 3600 -l ~/Library/Keychains/percy.keychain
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k percy ~/Library/Keychains/percy.keychain-db

codesign  --force --verbose=4 -s "Developer ID Application: BrowserStack Inc (763K6K6H44)" --options runtime --entitlements scripts/files/entitlement.plist --keychain ~/Library/Keychains/percy.keychain percy

zip percy-osx.zip percy
cat scripts/files/notarize_config.json.tmpl | sed -e "s/{{APPLE_ID_USERNAME}}/$APPLE_ID_USERNAME/" | sed -e "s/{{APPLE_ID_KEY}}/$APPLE_ID_KEY/" > notarize_config.json
gon -log-level=error -log-json notarize_config.json

cleanup
