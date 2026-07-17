import fs from 'fs';
import os from 'os';
import path from 'path';
import url from 'url';
import { createResource, createRootResource } from '@percy/cli-command/utils';

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

// Path hygiene at the fs boundary. Directory-entry names must be single path components (a name
// containing a separator or dot-segment never comes from an honest readdir) and path strings are
// NUL-stripped — also the sanitizer shape static analyzers recognize for path-join sinks.
export function sanitizePath(p) {
  return String(p).replace(/\0/g, '');
}

export function sanitizeDirentName(name) {
  let clean = String(name).replace(/\0/g, '');
  if (!clean || clean === '.' || clean === '..') return null;
  if (clean.includes('/') || clean.includes('\\')) return null;
  return clean;
}

// Collect @percy/* (and percy-*) package roots from the nearest node_modules — the same
// semantics as @percy/cli's command-discovery walk (findModulePackages): stop at the FIRST
// node_modules at or above `dir`, never cross the home directory, and degrade to [] on any
// filesystem error so discovery can never break `percy exec`.
function findPercyPackages(dir, log) {
  try {
    dir = sanitizePath(dir);

    // not given node_modules or a directory that contains node_modules, look up
    if (path.basename(dir) !== 'node_modules') {
      let modulesDir = path.join(dir, 'node_modules');
      let next = fs.existsSync(modulesDir) ? modulesDir : path.dirname(dir);
      if (next === dir || next === os.homedir()) return [];
      return findPercyPackages(next, log);
    }

    let found = [];

    for (let entry of fs.readdirSync(dir)) {
      let name = sanitizeDirentName(entry);
      // istanbul ignore next: readdir yields single path components — defense-in-depth only
      if (name === null) continue;

      if (name === '@percy') {
        for (let scopedEntry of fs.readdirSync(path.join(dir, name))) {
          let scoped = sanitizeDirentName(scopedEntry);
          // istanbul ignore next: readdir yields single path components — defense-in-depth only
          if (scoped === null) continue;
          found.push(path.join(dir, name, scoped));
        }
      } else if (name.startsWith('percy-')) {
        found.push(path.join(dir, name));
      }
    }

    return found;
  } catch (err) {
    log?.debug(`Baseline provider discovery walk failed: ${err.message}`);
    return [];
  }
}

// Find the first installed package declaring a baseline provider and import it. Returns null when
// none is installed (the overwhelmingly common case — one existsSync walk, negligible cost), or
// when the user opted out of the drop-in entirely (PERCY_DROPIN_DISABLE — the same switch the SDK
// override honors, so one env var turns off both the matcher and the seeding).
export async function findBaselineProvider({ cwd = process.cwd(), log } = {}) {
  if (process.env.PERCY_DROPIN_DISABLE === 'true') {
    log?.debug('Drop-in disabled via PERCY_DROPIN_DISABLE — skipping baseline provider discovery');
    return null;
  }
  for (let pkgPath of findPercyPackages(cwd, log)) {
    let pkgFile = path.join(sanitizePath(pkgPath), 'package.json');

    try {
      if (!fs.existsSync(pkgFile)) continue;
      let pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
      let providerPath = pkg['@percy/cli']?.baselineProvider;
      if (!providerPath) continue;

      // Confine the provider module to the declaring package — a package.json pointing outside
      // its own root (../../x.js) is malformed at best and gets skipped.
      let resolved = path.resolve(sanitizePath(pkgPath), sanitizePath(providerPath));
      if (!resolved.startsWith(path.resolve(sanitizePath(pkgPath)) + path.sep)) {
        log?.debug(`Skipping baseline provider from ${pkgPath}: provider path escapes the package`);
        continue;
      }

      let module = await import(url.pathToFileURL(resolved).href);
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

// The seed build keeps processing (renders + auto-approval) after finalize. The head build must
// not start until it reaches a terminal state — head snapshots select their baseline as they are
// processed, and an unapproved seed means the whole first run shows as new instead of diffing.
// The timeout matches the pipeline latency budget (~99% of builds finish under 5 minutes) —
// a seed of committed screenshots still renders server-side, so first runs can hold for minutes.
export async function waitForSeedBuild(client, buildId, { log, timeout = 600000, interval = 5000 }) {
  let deadline = Date.now() + timeout;
  let state = 'pending';
  let polls = 0;

  for (;;) {
    ({ state } = (await client.getBuild(buildId)).data.attributes);
    if (state !== 'pending' && state !== 'processing') return state;
    if (Date.now() >= deadline) return state;
    // A visible heartbeat every ~30s so a multi-minute first-run hold doesn't look like a hang.
    log[polls++ % 6 === 0 ? 'info' : 'debug'](
      `Baseline build still ${state} — waiting for it to finish before tests start`);
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// Establish the project's baseline from committed screenshots BEFORE the head build starts.
// Never throws — a seeding problem must not break `percy exec`. Returns true when a baseline
// build was created and finalized.
export async function maybeSeedBaseline(percy, provider, { log, waitTimeout, waitInterval }) {
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
    // A provider yielding sparse/null entries must not wedge the upload workers.
    baselines = baselines.filter(Boolean);
    if (!baselines.length) return false;

    // Ask the server. An explicit baseline source on an ESTABLISHED project returns the
    // baseline-skipped sentinel (no build persisted); on an empty project it creates build #1 as
    // the baseline. First-ness is decided by the API from the project token — never locally.
    let res = await percy.client.createBuild({
      projectType: percy.projectType,
      source: BASELINE_SOURCE,
      dropinBaselineCandidate: true
    });

    // The API decides first-ness: on an established project it answers with the baseline-skipped
    // sentinel (no data). Belt-and-braces for an API that predates the candidate attribute (it
    // would ignore it and hand back a NORMAL build): only ever seed build #1 — anything else
    // means this project is established, so abandon the build unused and point at the explicit
    // setup command instead of polluting history with stray "baseline" builds.
    if (!res?.data?.id || res.data.attributes?.['build-number'] !== 1) {
      log.info(`Found ${baselines.length} committed baseline snapshot(s), but this project ` +
        'already has builds — skipping baseline setup.');
      log.info('To (re)establish the baseline from your committed snapshots, run: ' +
        'npx percy playwright:setup-baseline');
      return false;
    }

    let buildId = res.data.id;
    log.info(`New Percy project with ${baselines.length} committed baseline snapshot(s) ` +
      'detected — establishing your baseline (build #1) before running tests');

    let seeded = await uploadBaselines(percy.client, buildId, baselines, {
      log, projectType: percy.projectType
    });

    await percy.client.finalizeBuild(buildId);

    let state;
    try {
      state = await waitForSeedBuild(percy.client, buildId, {
        log, timeout: waitTimeout, interval: waitInterval
      });
    } catch (err) {
      log.debug(`Baseline build wait failed: ${err.message}`);
    }

    if (state === 'finished') {
      log.info(`Baseline established from ${seeded}/${baselines.length} committed snapshot(s) ` +
        'and auto-approved — this run diffs against it.');
    } else {
      log.warn(`Baseline build did not finish processing in time (state: ${state}) — ` +
        'snapshots in this run may show as new instead of diffing against the baseline');
    }
    return true;
  } catch (err) {
    log.warn('Skipping baseline setup');
    log.debug(err.message);
    return false;
  }
}

// Clamp a pixel dimension to the API's accepted snapshot range (same as `percy upload`).
function clampDimension(value, fallback) {
  return Math.max(10, Math.min(value || fallback, 2000));
}

// A committed baseline PNG becomes a WEB snapshot: a generated root DOM displaying the image at
// its native size plus the image resource — the exact shape `percy upload` uses for web projects,
// so Percy renders the baseline in the project's own browsers and it pairs with the head run's
// DOM snapshots by (name, browser, width).
async function imageSnapshotResources({ name, filepath, width, height }) {
  let rootUrl = `http://local/${encodeURIComponent(name)}`;
  let imageUrl = `http://local/${encodeURIComponent(name)}.png`;
  let content = await fs.promises.readFile(filepath);

  return [
    createRootResource(rootUrl, `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>${name}</title>
          <style>
            *, *::before, *::after { margin: 0; padding: 0; font-size: 0; }
            html, body { width: 100%; }
            img { max-width: 100%; }
          </style>
        </head>
        <body>
          <img src="${imageUrl}" width="${width}px" height="${height}px"/>
        </body>
      </html>
    `),
    createResource(imageUrl, content, 'image/png')
  ];
}

// Bounded-concurrency upload of committed baseline files into `buildId`, shaped by project type:
//   • web — each PNG becomes a rendered WEB SNAPSHOT (root DOM + image resource); web projects
//     reject bare comparison tiles ("root resource" validation), and rendering server-side makes
//     the baseline pair with the head run's DOM snapshots.
//   • app — each PNG uploads straight through the COMPARISON ingest (tag + tile); no render flow
//     is triggered, exactly how App Percy ingests screenshots. The tag width is the identity
//     width (project viewport) so it pairs with the head run's uploads; height comes from the
//     PNG bytes.
// Per-file failures are skipped (a partial baseline beats none) and reported in the count.
export async function uploadBaselines(client, buildId, baselines, { log, projectType = 'web' }) {
  let queue = [...baselines];
  let seeded = 0;

  let uploadOne = async b => {
    if (projectType === 'app') {
      await client.sendComparison(buildId, {
        name: b.name,
        // Mirror the drop-in SDK's tag shape exactly (incl. browserName) — comparison pairing
        // matches on the canonical tag row, so any attribute difference orphans the baseline.
        tag: { name: b.browserFamily, browserName: b.browserFamily, width: b.width, height: b.height },
        tiles: [{ filepath: b.filepath }]
      });
    } else {
      await client.sendSnapshot(buildId, {
        name: b.name,
        widths: [clampDimension(b.width, 1280)],
        minHeight: clampDimension(b.height, 1024),
        resources: await imageSnapshotResources(b)
      });
    }
  };

  let worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      try {
        await uploadOne(b);
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
