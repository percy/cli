// Track F — functional discovery coverage (token-gated).
//
// Some discovery options have no reviewable visual effect — their correctness
// is in behavior (which headers/auth/cookies/user-agent reach the server, which
// resources are fetched or blocked). This harness runs ONE real `percy snapshot`
// against gated server routes and asserts on what those routes observed, so the
// assertions verify Percy's actual behavior rather than fragile debug-log text.
//
// Requires PERCY_TOKEN (real capture + upload); skips cleanly without it, like
// the visual regression harness.
//
// Run: node test/regression/functional.test.js  (or yarn test:regression:functional)

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startServers, stopServers, getObservations, resetObservations } from './server.js';
import { runPercy } from './lib/percy-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.PERCY_TOKEN) {
  console.log('Skipping functional regression tests (PERCY_TOKEN not set)');
  process.exit(0);
}

async function run() {
  console.log('Track F — functional discovery coverage (token-gated)\n');
  await startServers();
  console.log('Servers listening on 127.0.0.1:9100 and :9101');
  resetObservations();

  let result;
  try {
    result = await runPercy([
      'snapshot', join(__dirname, 'functional-snapshots.yml'),
      '--base-url', 'http://localhost:9100',
      '--config', join(__dirname, 'configs/functional-config.yml'),
      '--verbose'
    ], { cwd: __dirname });
  } finally {
    console.log('\nStopping test servers...');
    await stopServers();
  }

  const { code, output } = result;
  const obs = getObservations();

  let failures = 0;
  const check = (cond, msg) => {
    if (cond) {
      console.log(`  ✓ ${msg}`);
    } else {
      failures++;
      console.error(`  ✗ ${msg}`);
    }
  };

  console.log('');
  check(code === 0, `percy snapshot exits 0 (got ${code})`);
  check(/Finalized build/.test(output), 'build finalized');

  // discovery.requestHeaders — custom header injected on discovery requests
  check(obs.requestHeader === 'present',
    `discovery.requestHeaders sent (X-Percy-Regression=${obs.requestHeader})`);

  // discovery.authorization — Basic auth injected (route 401s without it)
  const decodedAuth = obs.authorization?.startsWith('Basic ')
    ? Buffer.from(obs.authorization.slice(6), 'base64').toString()
    : null;
  check(decodedAuth === 'percy:secret',
    `discovery.authorization sent (decoded=${decodedAuth})`);

  // discovery.cookies — Cookie header injected
  check(!!obs.cookie && obs.cookie.includes('session=regression-cookie'),
    `discovery.cookies sent (cookie=${obs.cookie})`);

  // discovery.userAgent — custom UA injected
  check(!!obs.userAgent && obs.userAgent.includes('PercyRegressionUA/1.0'),
    `discovery.userAgent sent (ua=${obs.userAgent})`);

  // discovery.captureSrcset — every srcset candidate fetched
  check(obs.srcset.includes('1x') && obs.srcset.includes('2x'),
    `discovery.captureSrcset fetched all candidates (got [${obs.srcset.join(', ')}])`);

  // discovery.disallowedHostnames — request to the disallowed 9101 host aborted
  // before it left the browser, so the server never saw it.
  check(obs.disallowedProbeRequested === false,
    'discovery.disallowedHostnames blocked the 9101 probe (server never hit)');
  check(/Skipping disallowed hostname/.test(output),
    'log confirms the disallowed-hostname skip');

  if (failures) {
    console.error(`\nTRACK F FAILED: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nTRACK F PASSED');
  process.exit(0);
}

run().catch(err => {
  console.error('Functional regression runner error:', err);
  stopServers().finally(() => process.exit(1));
});
