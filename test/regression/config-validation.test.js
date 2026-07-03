// Track C — CLI config validation (token-free, --dry-run).
//
// `percy snapshot --dry-run` skips discovery + upload and only enumerates
// snapshots, so it runs without a PERCY_TOKEN and without the test servers.
// Percy validates the FULL config (every registered namespace) at load time
// regardless of command mode, logging "Invalid config:" for any unknown or
// out-of-range option. This harness loads fixtures that set every non-excluded
// CLI config option and asserts the CLI accepts them all — the literal-100%
// option-coverage backbone for PER-8250.
//
// Run: node test/regression/config-validation.test.js  (or yarn test:regression:config)

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rmSync } from 'fs';
import { runPercy, snapshotCount, hasInvalidConfig } from './lib/percy-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// all-config.yml sets `percy.archiveDir`, which makes the CLI write a snapshot
// archive to disk. Keep the working tree clean by removing it around the run.
const archiveDir = join(__dirname, '.percy-archive');
const cleanArchive = () => rmSync(archiveDir, { recursive: true, force: true });

// Each case asserts: exits 0, the expected "Invalid config:" presence, and the
// expected snapshot count (catches snapshots silently dropping).
const CASES = [
  {
    name: 'all-config.yml — every global / static / sitemap option',
    args: ['snapshot', 'snapshots.yml', '--base-url', 'http://localhost:9100',
      '--config', 'configs/all-config.yml', '--dry-run'],
    expectCount: 25,
    expectValid: true
  },
  {
    name: 'alt-forms.yml — cookies array form + maxCacheRam null',
    args: ['snapshot', 'snapshots.yml', '--base-url', 'http://localhost:9100',
      '--config', 'configs/alt-forms.yml', '--dry-run'],
    expectCount: 25,
    expectValid: true
  },
  {
    name: 'per-snapshot-options.yml — capture-level options (execute, additionalSnapshots, discovery subset)',
    args: ['snapshot', 'per-snapshot-options.yml', '--dry-run'],
    expectCount: 8,
    expectValid: true
  },
  {
    // Server mode: `percy snapshot <dir>` exercises the /snapshot/server schema
    // (serve) plus the static cleanUrls flag, which list/base-url mode doesn't.
    name: 'static-site/ — server mode (serve) + cleanUrls via percy snapshot <dir>',
    args: ['snapshot', 'static-site', '--dry-run', '--clean-urls'],
    expectCount: 2,
    expectValid: true
  },
  {
    // Negative guard: proves the "Invalid config:" detector actually fires, so
    // the assertion protecting the valid fixtures above is not a no-op.
    name: 'invalid-example.yml — detector self-test (Invalid config EXPECTED)',
    args: ['snapshot', 'snapshots.yml', '--base-url', 'http://localhost:9100',
      '--config', 'configs/invalid-example.yml', '--dry-run'],
    expectCount: 25,
    expectValid: false
  }
];

async function run() {
  // Track C is token-free by design — ensure no token leaks build creation in.
  delete process.env.PERCY_TOKEN;
  const env = { PERCY_CLIENT_ERROR_LOGS: 'false' };

  let failures = 0;
  const check = (cond, msg) => {
    if (cond) {
      console.log(`  ✓ ${msg}`);
    } else {
      failures++;
      console.error(`  ✗ ${msg}`);
    }
  };

  console.log('Track C — CLI config validation (token-free, --dry-run)\n');

  for (const c of CASES) {
    console.log(`• ${c.name}`);
    const { code, output } = await runPercy(c.args, { env, cwd: __dirname });
    check(code === 0, `exits 0 (got ${code})`);

    const invalid = hasInvalidConfig(output);
    if (c.expectValid) {
      check(!invalid, 'no "Invalid config:" output — every option accepted');
    } else {
      check(invalid, '"Invalid config:" detected on intentionally-invalid fixture');
    }

    const count = snapshotCount(output);
    check(count === c.expectCount, `found ${c.expectCount} snapshots (got ${count})`);
    console.log('');
  }

  cleanArchive();

  if (failures) {
    console.error(`TRACK C FAILED: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('TRACK C PASSED');
  process.exit(0);
}

run().catch(err => {
  cleanArchive();
  console.error('Config-validation runner error:', err);
  process.exit(1);
});
