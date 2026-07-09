import fs from 'fs';
import path from 'path';
import url from 'url';

// Playwright drop-in baseline seeding — the `percy exec` side.
//
// Generic provider contract (framework knowledge stays in the SDK package, never in the CLI —
// the same reason command discovery works the way it does): any installed Percy SDK can declare
//
//   "@percy/cli": { "baselineProvider": "./path/to/module.js" }
//
// in its package.json. The module's default export must be:
//
//   {
//     buildSource,            // drop-in source tag for the head build (e.g. 'playwright-dropin')
//     async discoverBaselines({ cwd, log })
//       // -> { baselines: [{ filepath, name, browserFamily, width, height }], degraded?, reason? }
//   }
//
// When the user runs a plain `percy exec -- <cmd>` in a project with committed baseline
// screenshots and an EMPTY Percy project, the CLI establishes the baseline first (build #1,
// uploaded directly from the committed files — the user's test suite never runs for it) and only
// then starts the head build (#2) that runs the real command. The API auto-approves build #1
// server-side. On an established project nothing is seeded; the user is pointed at the explicit
// `percy playwright:setup-baseline` command instead.

// Parallel seed-upload cap: fast on large baseline sets without stampeding the API.
const SEED_CONCURRENCY = 8;

const BASELINE_SOURCE = 'playwright-dropin-baseline';

// Walk up from `dir` collecting @percy/* (and percy-*) package roots from each node_modules on
// the way — trimmed-down version of @percy/cli's command-discovery walk.
function findPercyPackages(dir) {
  let found = [];

  while (dir !== path.dirname(dir)) {
    let modulesDir = path.join(dir, 'node_modules');

    if (fs.existsSync(modulesDir)) {
      for (let name of fs.readdirSync(modulesDir)) {
        if (name === '@percy') {
          for (let scoped of fs.readdirSync(path.join(modulesDir, name))) {
            found.push(path.join(modulesDir, name, scoped));
          }
        } else if (name.startsWith('percy-')) {
          found.push(path.join(modulesDir, name));
        }
      }
    }

    dir = path.dirname(dir);
  }

  return found;
}

// Find the first installed package declaring a baseline provider and import it. Returns null when
// none is installed (the overwhelmingly common case — one existsSync walk, negligible cost).
export async function findBaselineProvider({ cwd = process.cwd(), log } = {}) {
  for (let pkgPath of findPercyPackages(cwd)) {
    let pkgFile = path.join(pkgPath, 'package.json');

    try {
      if (!fs.existsSync(pkgFile)) continue;
      let pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
      let providerPath = pkg['@percy/cli']?.baselineProvider;
      if (!providerPath) continue;

      let module = await import(url.pathToFileURL(path.join(pkgPath, providerPath)).href);
      let provider = module.default || module;

      if (typeof provider.discoverBaselines === 'function') {
        return { ...provider, packageName: pkg.name };
      }
    } catch (err) {
      log?.debug(`Skipping baseline provider from ${pkgPath}: ${err.message}`);
    }
  }

  return null;
}

// Establish the project's baseline from committed screenshots BEFORE the head build starts.
// Never throws — a seeding problem must not break `percy exec`. Returns true when a baseline
// build was created and finalized.
export async function maybeSeedBaseline(percy, provider, { log }) {
  try {
    // Parallel shards would race each other seeding; the head build dedup doesn't apply to the
    // separate seed build, so leave parallel runs to the explicit setup command.
    if (process.env.PERCY_PARALLEL_TOTAL) {
      log.debug('Skipping baseline seeding for a parallel build');
      return false;
    }

    let { baselines = [], degraded, reason } =
      (await provider.discoverBaselines({ cwd: process.cwd(), log })) || {};

    if (degraded) {
      log.debug(`Baseline discovery degraded (${reason}) — nothing seeded`);
      return false;
    }
    if (!baselines.length) return false;

    // Ask the server. An explicit baseline source on an ESTABLISHED project returns the
    // baseline-skipped sentinel (no build persisted); on an empty project it creates build #1 as
    // the baseline. First-ness is decided by the API from the project token — never locally.
    let res = await percy.client.createBuild({
      projectType: percy.projectType,
      source: BASELINE_SOURCE,
      dropinBaselineCandidate: true
    });

    if (!res?.data?.id) {
      log.info(`Found ${baselines.length} committed baseline snapshot(s), but this project ` +
        'already has builds — skipping baseline setup.');
      log.info('To (re)establish the baseline from your committed snapshots, run: ' +
        'npx percy playwright:setup-baseline');
      return false;
    }

    let buildId = res.data.id;
    log.info(`New Percy project with ${baselines.length} committed baseline snapshot(s) ` +
      'detected — establishing your baseline (build #1) before running tests');

    let seeded = await uploadBaselines(percy.client, buildId, baselines, { log });

    await percy.client.finalizeBuild(buildId);
    log.info(`Baseline established from ${seeded}/${baselines.length} committed snapshot(s) ` +
      'and auto-approved — this run diffs against it.');
    return true;
  } catch (err) {
    log.warn('Skipping baseline setup');
    log.debug(err.message);
    return false;
  }
}

// Bounded-concurrency upload of committed baseline files as comparisons of `buildId`. Per-file
// failures are skipped (a partial baseline beats none) and reported in the returned count.
export async function uploadBaselines(client, buildId, baselines, { log }) {
  let queue = [...baselines];
  let seeded = 0;

  let worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      try {
        await client.sendComparison(buildId, {
          name: b.name,
          tag: {
            name: b.browserFamily,
            width: b.width,
            height: b.height
          },
          tiles: [{ filepath: b.filepath }]
        });
        seeded += 1;
        log.progress(`Uploading baseline snapshots: ${seeded}/${baselines.length}`, true);
      } catch (err) {
        log.warn(`Skipped baseline snapshot "${b.name}": ${err.message}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SEED_CONCURRENCY, baselines.length) }, worker)
  );

  return seeded;
}
