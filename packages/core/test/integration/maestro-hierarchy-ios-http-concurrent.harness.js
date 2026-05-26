#!/usr/bin/env node
// Concurrent-access harness for the iOS HTTP view-hierarchy resolver
// (plan Unit 7 — V4.2). Calls runIosHttpDump against Maestro's iOS
// XCTestRunner /viewHierarchy endpoint while a real Maestro flow holds
// the device active via extendedWaitUntil. Asserts {kind: 'hierarchy'}
// on every iteration and records p50/p95/p99 timings to feed the
// IOS_HTTP_HEALTHY_DEADLINE_MS tuning decision before Unit 3b's flip.
//
// Skipped when MAESTRO_IOS_TEST_DEVICE is unset (CI default → exit 0).
// Run on a Mac with Xcode + Maestro + iOS Simulator OR on a BS realmobile
// host before flipping the iOS resolver default. Paste the green output
// (including p50/p95/p99) into the PR description.
//
// Modeled after PR #2210's maestro-hierarchy-concurrent.harness.js (gRPC).

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import { dump } from '../../src/maestro-hierarchy.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_PATH = path.resolve(__dirname, 'fixtures/pause-30s-flow-ios.yaml');
const MAESTRO_BIN = process.env.MAESTRO_BIN || 'maestro';
const UDID = process.env.MAESTRO_IOS_TEST_DEVICE;
const DRIVER_HOST_PORT = process.env.PERCY_IOS_DRIVER_HOST_PORT;
const ITERATIONS = Number.parseInt(process.env.PERCY_IOS_HTTP_HARNESS_ITERATIONS || '100', 10);

if (!UDID) {
  console.log('skip: MAESTRO_IOS_TEST_DEVICE not set — harness requires a real iOS device or simulator UDID');
  process.exit(0);
}
if (!DRIVER_HOST_PORT) {
  console.log('skip: PERCY_IOS_DRIVER_HOST_PORT not set — harness requires Maestro iOS driver host port (typically wda_port + 2700)');
  process.exit(0);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function spawnMaestroFlow() {
  return new Promise((resolve, reject) => {
    const proc = spawn(MAESTRO_BIN, ['--udid', UDID, '--driver-host-port', DRIVER_HOST_PORT, 'test', FLOW_PATH], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let pauseStarted = false;
    let stderrBuf = '';

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      if (!pauseStarted && text.includes('PERCY_PAUSE_BEGIN')) {
        pauseStarted = true;
        resolve(proc);
      }
    });
    proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (!pauseStarted) {
        reject(new Error(`Maestro flow exited (code ${code}) before PERCY_PAUSE_BEGIN sentinel was seen.\nstderr: ${stderrBuf}`));
      }
    });

    setTimeout(() => {
      if (!pauseStarted) {
        try { proc.kill('SIGKILL'); } catch { /* swallow */ }
        reject(new Error('timed out waiting for PERCY_PAUSE_BEGIN sentinel (60s)'));
      }
    }, 60_000);
  });
}

async function main() {
  console.log(`harness: udid=${UDID} driver_port=${DRIVER_HOST_PORT} iterations=${ITERATIONS} maestro=${MAESTRO_BIN}`);
  console.log(`harness: spawning maestro test ${FLOW_PATH}...`);

  // Set the env vars dump() reads.
  process.env.PERCY_IOS_DEVICE_UDID = UDID;
  process.env.PERCY_IOS_DRIVER_HOST_PORT = DRIVER_HOST_PORT;

  let maestroProc;
  try {
    maestroProc = await spawnMaestroFlow();
  } catch (err) {
    console.error(`harness: failed to spawn maestro flow: ${err.message}`);
    process.exit(2);
  }

  console.log('harness: maestro pause window active; running concurrent dump() iterations...');

  const timings = [];
  const failures = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = Date.now();
    try {
      const res = await dump({ platform: 'ios', sessionId: `harness-iter-${i}` });
      const elapsed = Date.now() - start;
      timings.push(elapsed);
      if (res.kind !== 'hierarchy') {
        failures.push({ iter: i, kind: res.kind, reason: res.reason, elapsed });
      }
    } catch (err) {
      timings.push(Date.now() - start);
      failures.push({ iter: i, error: err.message });
    }
  }

  // Confirm the maestro flow stayed alive throughout the iteration window.
  const stillAlive = !maestroProc.killed && maestroProc.exitCode === null;

  // Tear down: maestro will exit non-zero when extendedWaitUntil times out;
  // SIGKILL it now to avoid waiting for the full 30s.
  try { maestroProc.kill('SIGKILL'); } catch { /* swallow */ }

  const sorted = [...timings].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  console.log('');
  console.log('========================================================');
  console.log(`Results: ${ITERATIONS} iterations`);
  console.log(`  successful: ${ITERATIONS - failures.length}`);
  console.log(`  failed:     ${failures.length}`);
  console.log(`  p50:        ${p50}ms`);
  console.log(`  p95:        ${p95}ms`);
  console.log(`  p99:        ${p99}ms`);
  console.log(`  maestro flow stayed alive: ${stillAlive}`);
  console.log('========================================================');

  // KTD threshold check (matches Unit 7 plan): if p95 ≥ deadline × 0.9, suggest bumping.
  const HEALTHY_DEADLINE_MS = 1500;
  if (p95 >= HEALTHY_DEADLINE_MS * 0.9) {
    console.log(`WARNING: p95=${p95}ms is within 10% of IOS_HTTP_HEALTHY_DEADLINE_MS=${HEALTHY_DEADLINE_MS}.`);
    console.log(`         Consider bumping the deadline to ${p95 * 2}ms before Unit 3b's flip.`);
  } else {
    console.log(`OK: p95=${p95}ms is comfortably below the ${HEALTHY_DEADLINE_MS}ms healthy-call deadline.`);
  }

  if (failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const f of failures.slice(0, 10)) console.log(`  iter ${f.iter}: ${JSON.stringify(f)}`);
    if (failures.length > 10) console.log(`  ...and ${failures.length - 10} more`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('harness: fatal:', err);
  process.exit(2);
});
