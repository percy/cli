#!/usr/bin/env node
// Concurrent-access regression harness for the maestro view-hierarchy
// resolver. Calls dump() while a real Maestro flow is actively holding the
// UiAutomator session via extendedWaitUntil + impossible selector, asserts
// `{ kind: 'hierarchy' }`, and confirms the parallel Maestro flow remains
// alive. Records p50/p95/p99 timing across N=100 iterations to feed the
// 250ms healthy-call deadline tuning decision in the plan KTD.
//
// Skipped when MAESTRO_ANDROID_TEST_DEVICE is unset (CI default → exit 0).
// Run on a dev machine or BrowserStack host before merging Phase 2.2.
// Paste the green output (including p50/p95/p99) into the PR description.
//
// Prerequisites + invocation: see ./README.md.

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import { dump } from '../../src/maestro-hierarchy.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FLOW_PATH = path.resolve(__dirname, 'fixtures/pause-30s-flow.yaml');
const MAESTRO_BIN = process.env.MAESTRO_BIN || 'maestro';
const SERIAL = process.env.MAESTRO_ANDROID_TEST_DEVICE;
const ITERATIONS = Number.parseInt(process.env.PERCY_GRPC_HARNESS_ITERATIONS || '100', 10);

if (!SERIAL) {
  console.log('skip: MAESTRO_ANDROID_TEST_DEVICE not set — harness requires a real Android device');
  process.exit(0);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function spawnMaestroFlow() {
  return new Promise((resolve, reject) => {
    const proc = spawn(MAESTRO_BIN, ['--udid', SERIAL, 'test', FLOW_PATH], {
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

    // Hard cap on the wait so a stuck Maestro flow doesn't hang the harness.
    setTimeout(() => {
      if (!pauseStarted) {
        try { proc.kill('SIGKILL'); } catch { /* swallow */ }
        reject(new Error('timed out waiting for PERCY_PAUSE_BEGIN sentinel (60s)'));
      }
    }, 60_000);
  });
}

async function main() {
  console.log(`harness: device=${SERIAL} iterations=${ITERATIONS} maestro=${MAESTRO_BIN}`);
  console.log(`harness: spawning maestro test ${FLOW_PATH}...`);

  let maestroProc;
  try {
    maestroProc = await spawnMaestroFlow();
  } catch (err) {
    console.error('harness FAIL:', err.message);
    process.exit(1);
  }
  console.log('harness: PERCY_PAUSE_BEGIN seen — Maestro flow now holds UiAutomator session.');

  const timings = [];
  const failures = [];

  try {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = Date.now();
      let result;
      try {
        result = await dump({ platform: 'android' });
      } catch (err) {
        failures.push(`iter ${i}: dump threw: ${err.message}`);
        continue;
      }
      const elapsed = Date.now() - start;
      timings.push(elapsed);

      if (result.kind !== 'hierarchy') {
        failures.push(`iter ${i}: kind=${result.kind} reason=${result.reason} (${elapsed}ms)`);
        continue;
      }
      if (!Array.isArray(result.nodes) || result.nodes.length === 0) {
        failures.push(`iter ${i}: hierarchy has no nodes (${elapsed}ms)`);
      }
    }
  } finally {
    // Confirm the parallel Maestro flow is still alive (our dump should
    // not have killed it via SIGKILL contention) before tearing it down.
    let stillAlive = true;
    try { process.kill(maestroProc.pid, 0); } catch { stillAlive = false; }
    if (!stillAlive) {
      failures.push('Maestro flow was no longer alive after the dump iterations completed');
    }
    try { maestroProc.kill('SIGTERM'); } catch { /* swallow */ }
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  console.log(`harness: completed ${timings.length}/${ITERATIONS} iterations`);
  console.log(`harness: timings p50=${p50}ms p95=${p95}ms p99=${p99}ms`);

  if (failures.length > 0) {
    console.error(`harness FAIL: ${failures.length} iteration(s) failed:`);
    for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('harness PASS');
  process.exit(0);
}

main().catch(err => {
  console.error('harness FAIL (unhandled):', err);
  process.exit(1);
});
