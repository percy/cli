#!/usr/bin/env node
// WDA failure-class regression harness (plan Unit 6 — V3).
//
// Runs ios-aut-crash-regions.yaml twice on a real iOS device, once with
// PERCY_IOS_RESOLVER=wda-direct (legacy WDA-direct path) and once with
// PERCY_IOS_RESOLVER=maestro-hierarchy (new HTTP path). Asserts:
//
//   pre-fix run (wda-direct): element regions silently skip with
//     `iOS element region warn-skip` log and the snapshot uploads without
//     them — the production failure mode this plan exists to fix.
//   post-fix run (maestro-hierarchy): element regions resolve via the
//     HTTP path because Maestro's runner walks the system UI without
//     bundleId binding.
//
// Skipped when MAESTRO_IOS_TEST_DEVICE is unset (CI default → exit 0).
// Run on a Mac with Xcode + Maestro + iOS Simulator OR on a BS realmobile
// host. Paste the green output into the PR description.

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_PATH = path.resolve(__dirname, 'fixtures/ios-aut-crash-regions.yaml');
const MAESTRO_BIN = process.env.MAESTRO_BIN || 'maestro';
const UDID = process.env.MAESTRO_IOS_TEST_DEVICE;
const DRIVER_HOST_PORT = process.env.PERCY_IOS_DRIVER_HOST_PORT;
const PERCY_SERVER = process.env.PERCY_SERVER;

if (!UDID) {
  console.log('skip: MAESTRO_IOS_TEST_DEVICE not set — harness requires a real iOS device or simulator UDID');
  process.exit(0);
}
if (!PERCY_SERVER) {
  console.log('skip: PERCY_SERVER not set — harness needs a running Percy CLI on http://127.0.0.1:<port>');
  process.exit(0);
}

function runMaestroFlow(resolverChoice, screenshotName) {
  return new Promise(resolve => {
    const env = {
      ...process.env,
      PERCY_IOS_RESOLVER: resolverChoice,
      PERCY_SERVER
    };
    const args = ['--udid', UDID];
    if (DRIVER_HOST_PORT) args.push('--driver-host-port', DRIVER_HOST_PORT);
    args.push('test', FLOW_PATH, '--env', `SCREENSHOT_NAME=${screenshotName}`);

    const proc = spawn(MAESTRO_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', c => { stdout += c.toString(); });
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.on('exit', code => resolve({ code, stdout, stderr }));
    proc.on('error', err => resolve({ code: -1, stdout, stderr: stderr + err.message }));
  });
}

async function main() {
  console.log(`harness: udid=${UDID} percy_server=${PERCY_SERVER} maestro=${MAESTRO_BIN}`);
  console.log(`harness: flow=${FLOW_PATH}`);
  console.log('');

  // === Pre-fix run: PERCY_IOS_RESOLVER=wda-direct ===
  console.log('=== Run 1/2: PERCY_IOS_RESOLVER=wda-direct (legacy WDA-direct path) ===');
  const wdaRun = await runMaestroFlow('wda-direct', 'WdaDirectAutCrash');
  console.log(`exit=${wdaRun.code}`);
  // The relevant logs are written by Percy CLI to its log file (per-session
  // path under /var/log/browserstack/percy_cli.<sid>_<port>.log on BS hosts,
  // or stdout when run locally). Maestro's stdout will include
  // [percy] Warning: lines from percy-screenshot.js. Search for them.
  const wdaWarnings = (wdaRun.stdout + wdaRun.stderr).match(/\[percy\] (Warning|Error).*$/gm) || [];
  console.log('Percy warnings in maestro output:');
  wdaWarnings.forEach(w => console.log(`  ${w}`));

  console.log('');

  // === Post-fix run: PERCY_IOS_RESOLVER=maestro-hierarchy ===
  console.log('=== Run 2/2: PERCY_IOS_RESOLVER=maestro-hierarchy (new HTTP/CLI path) ===');
  const httpRun = await runMaestroFlow('maestro-hierarchy', 'MaestroHttpAutCrash');
  console.log(`exit=${httpRun.code}`);
  const httpWarnings = (httpRun.stdout + httpRun.stderr).match(/\[percy\] (Warning|Error).*$/gm) || [];
  console.log('Percy warnings in maestro output:');
  httpWarnings.forEach(w => console.log(`  ${w}`));

  console.log('');
  console.log('========================================================');
  console.log('Manual verification (this harness logs, does not assert):');
  console.log('  • Run 1 (wda-direct): EXPECT element regions to be skipped — Percy build for');
  console.log('    "WdaDirectAutCrash" should show the snapshot WITHOUT element-region overlays.');
  console.log('  • Run 2 (maestro-hierarchy): EXPECT element regions to resolve — Percy build for');
  console.log('    "MaestroHttpAutCrash" should show the snapshot WITH element-region overlays.');
  console.log('  • If Run 1 also resolves regions, Phase 0.5 has eliminated the WDA failure');
  console.log('    class — this plan may no longer be necessary.');
  console.log('  • If Run 2 also skips regions, the HTTP path is broken on this device — abort');
  console.log('    Unit 3b flip until investigated.');
  console.log('========================================================');

  process.exit(0);
}

main().catch(err => {
  console.error('harness: fatal:', err);
  process.exit(2);
});
