mkdir temp && cd temp

npm init -y

npm install --save-dev @percy/cli

npm install -g pkg

cd ..

yarn install

cp -R ./temp/node_modules/@percy/* packages/

# Copy current src to dist
cp -R packages/cli/src/ packages/cli/dist/
cp -R packages/cli-app/src/ packages/cli-app/dist/
cp -R packages/cli-build/src/ packages/cli-build/dist/
cp -R packages/cli-command/src/ packages/cli-command/dist/
cp -R packages/cli-config/src/ packages/cli-config/dist/
cp -R packages/cli-exec/src/ packages/cli-exec/dist/
cp -R packages/cli-snapshot/src/ packages/cli-snapshot/dist/
cp -R packages/cli-upload/src/ packages/cli-upload/dist/
cp -R packages/client/src/ packages/client/dist/
cp -R packages/config/src/ packages/config/dist/
cp -R packages/core/src/ packages/core/dist/
cp -R packages/dom/src/ packages/dom/dist/
cp -R packages/env/src/ packages/env/dist/
cp -R packages/logger/src/ packages/logger/dist/
cp -R packages/sdk-utils/src/ packages/sdk-utils/dist/ 
cp -R packages/webdriver-utils/src/ packages/webdriver-utils/dist/

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

npm run build_cjs

cp -R ./build/* packages/

pkg --targets node14-linux-x64,node14-macos-x64,node14-macos-arm64,node14-win-x64,node14-linux-arm64  ./packages/cli/bin/run.js -d

ls
mv run-macos-x64 percy-macos-x64
mv run-macos-arm64 percy-macos-arm64
mv run-linux-arm64 percy-linux-arm64
mv run-linux-x64 percy-linux-x64
mv run-win-x64.exe percy-win-x64.exe

# cleanup
rm -rf temp
rm -rf build

# Sign & Notrize mac app

echo "$APPLE_DEV_CERT" | base64 -d > AppleDevIDApp.p12

security create-keychain -p percy percy.keychain
security import AppleDevIDApp.p12 -t agg -k percy.keychain -P ChaiTime -A
security list-keychains -s ~/Library/Keychains/percy.keychain
security default-keychain -s ~/Library/Keychains/percy.keychain
security unlock-keychain -p "percy" ~/Library/Keychains/percy.keychain
security set-keychain-settings -t 3600 -l ~/Library/Keychains/percy.keychain
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k percy ~/Library/Keychains/percy.keychain-db

codesign  --force --verbose=4 --deep -s "Developer ID Application: BrowserStack Inc (763K6K6H44)" --options runtime --keychain ~/Library/Keychains/percy.keychain percy-macos-arm64
codesign  --force --verbose=4 --deep -s "Developer ID Application: BrowserStack Inc (763K6K6H44)" --options runtime --keychain ~/Library/Keychains/percy.keychain percy-macos-x64

zip percy-macos-arm64.zip percy-macos-arm64
zip percy-macos-x64.zip percy-macos-x64

cat scripts/notarize_config.json.tmpl | sed -e "s/{{APPLE_ID_USERNAME}}/$APPLE_ID_USERNAME/" | sed -e "s/{{APPLE_ID_KEY}}/$APPLE_ID_KEY/" | sed -e "s/{{ZIP}}/percy-macos-x64.zip/" | sed -e "s/{{BUNDLE_ID}}/com.percy.io.intel/" > notarize_config_intel.json
cat scripts/notarize_config.json.tmpl | sed -e "s/{{APPLE_ID_USERNAME}}/$APPLE_ID_USERNAME/" | sed -e "s/{{APPLE_ID_KEY}}/$APPLE_ID_KEY/" | sed -e "s/{{ZIP}}/percy-macos-arm64.zip/" | sed -e "s/{{BUNDLE_ID}}/com.percy.io.arm/" > notarize_config_arm.json

gon -log-level=info -log-json notarize_config_intel.json
gon -log-level=info -log-json notarize_config_arm.json

security delete-keychain percy.keychain
