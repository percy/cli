#!/bin/bash

function cleanup {
  rm -rf build
  rm AppleDevIDApp.p12
  rm notarize_config.json
  security delete-keychain percy.keychain
}

npm install -g pkg

yarn build

yarn install

# Remove type from package.json files
sed -i '' '/"type": "module",/d' ./package.json
cd packages && sed -i '' '/"type": "module",/d' ./*/package.json && cd ..

echo "import { cli } from '@percy/cli';\
$(cat ./packages/cli/dist/percy.js)" > ./packages/cli/dist/percy.js

sed -i '' '/Inserts formatFilepath function/a \
function formatFilepath(filepath) {\
  let path = url.pathToFileURL(filepath).href.replace("file:///","");\
  if (!path.includes("C:")) {\
    path = "/" + path;\
  }\
  return path;\
}
' ./packages/cli/dist/commands.js

sed -i '' 's/import(url.pathToFileURL(modulePath).href);/import(formatFilepath(modulePath));/g' ./packages/cli/dist/commands.js

echo "import { execSync } from 'child_process';\
$(cat ./packages/core/dist/install.js)" > ./packages/core/dist/install.js

sed -i '' '/Update outdir to absolute path/a \
      var output = execSync(command, { encoding: "utf-8" }).trim();\
      archive = output.concat("/", archive);\
      outdir = output.concat("/", outdir);
' ./packages/core/dist/install.js

sed -i '' '/let archive/a \
  var command = "pwd";\
  if (archive.includes("C:")) {\
    command = "cd";\
  }\
  outdir = outdir.replace("C:\\\\","");\
  archive = archive.replace("C:\\\\","");
' ./packages/core/dist/install.js

sed -i '' '/let outdir/a \
  if (outdir.charAt(0) == "/") {\
    outdir = outdir.replace("/", "");\
  }
' ./packages/core/dist/install.js

# Convert ES6 code to cjs
npm run build_cjs
cp -R ./build/* packages/

# Create executables
pkg ./packages/cli/bin/run.js -d

# Rename executables
mv run-macos percy-macos
mv run-linux percy-linux
mv run-win.exe percy-win.exe

# Sign & Notrize mac app
echo "$APPLE_DEV_CERT" | base64 -d > AppleDevIDApp.p12

security create-keychain -p percy percy.keychain
security import AppleDevIDApp.p12 -t agg -k percy.keychain -P ChaiTime -A
security list-keychains -s ~/Library/Keychains/percy.keychain
security default-keychain -s ~/Library/Keychains/percy.keychain
security unlock-keychain -p "percy" ~/Library/Keychains/percy.keychain
security set-keychain-settings -t 3600 -l ~/Library/Keychains/percy.keychain
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k percy ~/Library/Keychains/percy.keychain-db

codesign  --force --verbose=4 -s "Developer ID Application: BrowserStack Inc (763K6K6H44)" --options runtime --entitlements scripts/files/entitlement.plist --keychain ~/Library/Keychains/percy.keychain percy-macos

zip percy-macos.zip percy-macos
cat scripts/files/notarize_config.json.tmpl | sed -e "s/{{APPLE_ID_USERNAME}}/$APPLE_ID_USERNAME/" | sed -e "s/{{APPLE_ID_KEY}}/$APPLE_ID_KEY/" > notarize_config.json
gon -log-level=error -log-json notarize_config.json

cleanup
