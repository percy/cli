#!/usr/bin/env node
// Benchmark harness for @percy/logger redaction + memory bounds.
//
// CI merge gate for PRs that touch packages/logger/src/* or the secret-
// patterns JSON. See DPR-22 in
// docs/plans/2026-04-23-001-feat-disk-backed-hybrid-log-store-plan.md.
//
// Usage:
//   node scripts/bench-logger.js             # redactString perf gate
//   node scripts/bench-logger.js --mem       # 10k-snapshot RSS gate
//
// Fixture corpus:
//   packages/logger/test/fixtures/bench-log-corpus.jsonl
//   ~1000 synthesized Percy-shaped log lines; ~98% clean, ~2% slow-path.
//   No customer data. Regenerate with scripts/generate-bench-fixtures.js.

import { readFileSync } from 'fs';
import { performance } from 'perf_hooks';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const mode = process.argv.includes('--mem') ? 'mem' : 'perf';

async function runPerf () {
  const { redactString, PATTERNS_COUNT, MARKER_COUNT } = await import(
    path.join(REPO_ROOT, 'packages/logger/src/redact.js')
  );

  const corpus = readFileSync(
    path.join(REPO_ROOT, 'packages/logger/test/fixtures/bench-log-corpus.jsonl'),
    'utf8'
  ).split('\n').filter(Boolean).map(l => JSON.parse(l).message);

  // Warm up V8 JIT
  for (let i = 0; i < 5000; i++) redactString(corpus[i % corpus.length]);

  const N = 100000;
  const samples = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    redactString(corpus[i % corpus.length]);
    samples[i] = (performance.now() - t0) * 1000; // µs
  }
  samples.sort();

  const result = {
    patterns: PATTERNS_COUNT,
    markers: MARKER_COUNT,
    corpus_size: corpus.length,
    samples: N,
    p50_us: +samples[Math.floor(N * 0.50)].toFixed(2),
    p95_us: +samples[Math.floor(N * 0.95)].toFixed(2),
    p99_us: +samples[Math.floor(N * 0.99)].toFixed(2),
    p999_us: +samples[Math.floor(N * 0.999)].toFixed(2)
  };

  console.log(JSON.stringify(result, null, 2));

  const budgets = { p50_us: 10, p99_us: 100, p999_us: 3000 };
  let failed = false;
  for (const [key, budget] of Object.entries(budgets)) {
    if (result[key] >= budget) {
      console.error(`FAIL: ${key} ${result[key]}µs exceeds budget ${budget}µs`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

async function runMem () {
  const { HybridLogStore } = await import(
    path.join(REPO_ROOT, 'packages/logger/src/hybrid-log-store.js')
  );
  const { snapshotKey } = await import(
    path.join(REPO_ROOT, 'packages/logger/src/internal-utils.js')
  );

  const store = new HybridLogStore({});
  const baseline = process.memoryUsage().rss;

  // Synthetic 10k-snapshot workload. Each iteration:
  //   1. Push N snapshot-tagged log entries.
  //   2. Call evictSnapshot with the canonical key produced by snapshotKey.
  // Max concurrency is modelled at 10 live-at-a-time buckets to match real
  // Percy behavior.
  const LIVE = 10;
  const TOTAL = 10000;
  const ENTRIES_PER_SNAPSHOT = 30;
  const live = [];
  let maxRss = 0;

  for (let i = 0; i < TOTAL; i++) {
    const name = `snapshot-${i}`;
    const meta = { snapshot: { name, testCase: '' } };
    for (let j = 0; j < ENTRIES_PER_SNAPSHOT; j++) {
      store.push({
        debug: 'core:discovery',
        level: 'debug',
        message: `Discovering resource ${j} for ${name}`,
        meta,
        timestamp: Date.now(),
        error: false
      });
    }
    live.push(snapshotKey(meta));
    if (live.length >= LIVE) {
      const old = live.shift();
      store.evictSnapshot(old);
    }
    if (i % 100 === 0) {
      const rss = process.memoryUsage().rss;
      if (rss > maxRss) maxRss = rss;
    }
  }

  await store.reset();

  const delta = maxRss - baseline;
  const MB = 1024 * 1024;
  const result = {
    baseline_rss_mb: +(baseline / MB).toFixed(1),
    max_rss_mb: +(maxRss / MB).toFixed(1),
    delta_mb: +(delta / MB).toFixed(1),
    total_snapshots: TOTAL,
    entries_per_snapshot: ENTRIES_PER_SNAPSHOT,
    live_buckets: LIVE
  };
  console.log(JSON.stringify(result, null, 2));

  // Budget includes: compiled regex set (~2.5 MB), marker + always-run
  // unioned regexes, V8 internal structures, and headroom for 10 live
  // snapshot buckets × ~30 entries. Empirically ~18 MB with the current
  // secret-patterns set; 25 MB leaves room for pattern-set growth.
  const BUDGET_MB = 25;
  if (result.delta_mb > BUDGET_MB) {
    console.error(`FAIL: RSS delta ${result.delta_mb} MB exceeds budget ${BUDGET_MB} MB`);
    process.exit(1);
  }
  process.exit(0);
}

if (mode === 'mem') runMem().catch(err => { console.error(err); process.exit(1); });
else runPerf().catch(err => { console.error(err); process.exit(1); });
