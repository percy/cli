import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  findBaselineProvider,
  maybeSeedBaseline,
  uploadBaselines
} from '../src/baseline.js';

// Collecting fake logger — baseline.js only needs these four methods.
function fakeLog() {
  let entries = { info: [], warn: [], debug: [], progress: [] };
  return {
    entries,
    info: m => entries.info.push(m),
    warn: m => entries.warn.push(m),
    debug: m => entries.debug.push(m),
    progress: m => entries.progress.push(m)
  };
}

const BASELINES = [
  { filepath: '/repo/a.png', name: 'home', browserFamily: 'chromium', width: 1280, height: 720 },
  { filepath: '/repo/b.png', name: 'cart', browserFamily: 'chromium', width: 1280, height: 800 }
];

function fakeClient({ established = false, failComparisons = false } = {}) {
  let calls = { createBuild: [], sendComparison: [], finalizeBuild: [] };
  return {
    calls,
    async createBuild(options) {
      calls.createBuild.push(options);
      // Established projects answer with the baseline-skipped sentinel (no data).
      if (established) return { 'baseline-skipped': true, 'already-established': true };
      return { data: { id: 'seed-build-1', attributes: { 'build-number': 1 } } };
    },
    async sendComparison(buildId, options) {
      calls.sendComparison.push({ buildId, options });
      if (failComparisons) throw new Error('upload failed');
    },
    async finalizeBuild(buildId) {
      calls.finalizeBuild.push(buildId);
    }
  };
}

describe('exec baseline seeding', () => {
  beforeEach(() => {
    delete process.env.PERCY_PARALLEL_TOTAL;
  });

  describe('maybeSeedBaseline', () => {
    it('seeds an empty project: creates the baseline build, uploads, finalizes', async () => {
      let client = fakeClient();
      let log = fakeLog();
      let provider = { discoverBaselines: async () => ({ baselines: BASELINES }) };

      let seeded = await maybeSeedBaseline({ client, projectType: 'web' }, provider, { log });

      expect(seeded).toBe(true);
      expect(client.calls.createBuild[0]).toEqual(jasmine.objectContaining({
        source: 'playwright-dropin-baseline',
        dropinBaselineCandidate: true
      }));
      expect(client.calls.sendComparison.length).toBe(2);
      expect(client.calls.sendComparison[0].buildId).toBe('seed-build-1');
      expect(client.calls.sendComparison.map(c => c.options.name).sort())
        .toEqual(['cart', 'home']);
      expect(client.calls.sendComparison[0].options.tag).toEqual(
        jasmine.objectContaining({ name: 'chromium', width: 1280 }));
      expect(client.calls.finalizeBuild).toEqual(['seed-build-1']);
      expect(log.entries.info.join('\n')).toContain('establishing your baseline');
      expect(log.entries.info.join('\n')).toContain('auto-approved');
    });

    it('skips an established project and points at the setup command', async () => {
      let client = fakeClient({ established: true });
      let log = fakeLog();
      let provider = { discoverBaselines: async () => ({ baselines: BASELINES }) };

      let seeded = await maybeSeedBaseline({ client, projectType: 'web' }, provider, { log });

      expect(seeded).toBe(false);
      expect(client.calls.sendComparison.length).toBe(0);
      expect(client.calls.finalizeBuild.length).toBe(0);
      expect(log.entries.info.join('\n')).toContain('already has builds');
      expect(log.entries.info.join('\n')).toContain('percy playwright:setup-baseline');
    });

    it('does nothing when discovery finds no baselines', async () => {
      let client = fakeClient();
      let log = fakeLog();
      let provider = { discoverBaselines: async () => ({ baselines: [] }) };

      let seeded = await maybeSeedBaseline({ client, projectType: 'web' }, provider, { log });

      expect(seeded).toBe(false);
      expect(client.calls.createBuild.length).toBe(0);
    });

    it('does nothing when discovery degrades', async () => {
      let client = fakeClient();
      let log = fakeLog();
      let provider = {
        discoverBaselines: async () => ({ baselines: [], degraded: true, reason: 'custom_template' })
      };

      let seeded = await maybeSeedBaseline({ client, projectType: 'web' }, provider, { log });

      expect(seeded).toBe(false);
      expect(client.calls.createBuild.length).toBe(0);
      expect(log.entries.debug.join('\n')).toContain('custom_template');
    });

    it('skips parallel builds', async () => {
      process.env.PERCY_PARALLEL_TOTAL = '-1';
      let client = fakeClient();
      let log = fakeLog();
      let provider = { discoverBaselines: async () => ({ baselines: BASELINES }) };

      let seeded = await maybeSeedBaseline({ client, projectType: 'web' }, provider, { log });

      expect(seeded).toBe(false);
      expect(client.calls.createBuild.length).toBe(0);
    });

    it('never throws — a seeding error degrades to a warning', async () => {
      let log = fakeLog();
      let provider = { discoverBaselines: async () => { throw new Error('boom'); } };

      let seeded = await maybeSeedBaseline({ client: fakeClient(), projectType: 'web' }, provider, { log });

      expect(seeded).toBe(false);
      expect(log.entries.warn.join('\n')).toContain('Skipping baseline setup');
      expect(log.entries.debug.join('\n')).toContain('boom');
    });
  });

  describe('uploadBaselines', () => {
    it('skips per-file failures and reports the seeded count', async () => {
      let client = fakeClient({ failComparisons: true });
      let log = fakeLog();

      let seeded = await uploadBaselines(client, 'b1', BASELINES, { log });

      expect(seeded).toBe(0);
      expect(log.entries.warn.length).toBe(2);
      expect(log.entries.warn[0]).toContain('Skipped baseline snapshot');
    });
  });

  describe('findBaselineProvider', () => {
    let tmpDir;

    beforeEach(() => {
      // A fake installed SDK declaring a baseline provider, discovered by the node_modules walk.
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-baseline-'));
      let pkgDir = path.join(tmpDir, 'node_modules', '@percy', 'fake-sdk');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: '@percy/fake-sdk',
        '@percy/cli': { baselineProvider: 'provider.cjs' }
      }));
      fs.writeFileSync(path.join(pkgDir, 'provider.cjs'), [
        'module.exports = {',
        "  buildSource: 'playwright-dropin',",
        '  discoverBaselines: async () => ({ baselines: [] })',
        '};'
      ].join('\n'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('finds a provider declared by an installed @percy package', async () => {
      let provider = await findBaselineProvider({ cwd: tmpDir, log: fakeLog() });

      expect(provider).not.toBeNull();
      expect(provider.packageName).toBe('@percy/fake-sdk');
      expect(provider.buildSource).toBe('playwright-dropin');
      expect(typeof provider.discoverBaselines).toBe('function');
    });

    it('returns null when no package declares a provider', async () => {
      let bare = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-noprov-'));
      try {
        expect(await findBaselineProvider({ cwd: bare, log: fakeLog() })).toBeNull();
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });

    it('skips a package whose provider module fails to load', async () => {
      let pkgDir = path.join(tmpDir, 'node_modules', '@percy', 'fake-sdk');
      fs.writeFileSync(path.join(pkgDir, 'provider.cjs'), 'throw new Error("bad module");');

      let log = fakeLog();
      expect(await findBaselineProvider({ cwd: tmpDir, log })).toBeNull();
      expect(log.entries.debug.join('\n')).toContain('bad module');
    });
  });
});
