import { resolveReadinessConfig, PRESETS, waitForReadiness } from '../../src/readiness.js';
import logger from '@percy/logger/test/helpers';

describe('Unit / Readiness', () => {
  beforeEach(async () => {
    await logger.mock();
  });

  describe('resolveReadinessConfig', () => {
    it('returns balanced preset defaults when no options provided', () => {
      let config = resolveReadinessConfig({});
      expect(config.preset).toBe('balanced');
      expect(config.stability_window_ms).toBe(300);
      expect(config.network_idle_window_ms).toBe(200);
      expect(config.timeout_ms).toBe(10000);
      expect(config.image_ready).toBe(true);
      expect(config.font_ready).toBe(true);
    });

    it('returns disabled config when preset is disabled', () => {
      let config = resolveReadinessConfig({ readiness: { preset: 'disabled' } });
      expect(config).toEqual({ preset: 'disabled' });
    });

    it('resolves strict preset values', () => {
      let config = resolveReadinessConfig({ readiness: { preset: 'strict' } });
      expect(config.preset).toBe('strict');
      expect(config.stability_window_ms).toBe(1000);
      expect(config.network_idle_window_ms).toBe(500);
      expect(config.timeout_ms).toBe(30000);
      expect(config.image_ready).toBe(true);
      expect(config.font_ready).toBe(true);
    });

    it('resolves fast preset values', () => {
      let config = resolveReadinessConfig({ readiness: { preset: 'fast' } });
      expect(config.preset).toBe('fast');
      expect(config.stability_window_ms).toBe(100);
      expect(config.network_idle_window_ms).toBe(100);
      expect(config.timeout_ms).toBe(5000);
      expect(config.image_ready).toBe(false);
      expect(config.font_ready).toBe(true);
    });

    it('falls back to balanced for unknown preset names', () => {
      let config = resolveReadinessConfig({ readiness: { preset: 'turbo' } });
      expect(config.preset).toBe('turbo');
      expect(config.stability_window_ms).toBe(PRESETS.balanced.stability_window_ms);
      expect(config.timeout_ms).toBe(PRESETS.balanced.timeout_ms);
    });

    it('allows camelCase overrides of preset values', () => {
      let config = resolveReadinessConfig({
        readiness: {
          preset: 'balanced',
          stabilityWindowMs: 500,
          networkIdleWindowMs: 300,
          timeoutMs: 15000,
          imageReady: false,
          fontReady: false
        }
      });
      expect(config.stability_window_ms).toBe(500);
      expect(config.network_idle_window_ms).toBe(300);
      expect(config.timeout_ms).toBe(15000);
      expect(config.image_ready).toBe(false);
      expect(config.font_ready).toBe(false);
    });

    it('allows snake_case overrides of preset values', () => {
      let config = resolveReadinessConfig({
        readiness: {
          preset: 'fast',
          stability_window_ms: 200,
          network_idle_window_ms: 150
        }
      });
      expect(config.stability_window_ms).toBe(200);
      expect(config.network_idle_window_ms).toBe(150);
    });

    it('prefers camelCase over snake_case when both provided', () => {
      let config = resolveReadinessConfig({
        readiness: {
          stabilityWindowMs: 600,
          stability_window_ms: 400
        }
      });
      expect(config.stability_window_ms).toBe(600);
    });

    it('includes readySelectors when provided (camelCase)', () => {
      let config = resolveReadinessConfig({
        readiness: { readySelectors: ['[data-loaded]', '.ready'] }
      });
      expect(config.ready_selectors).toEqual(['[data-loaded]', '.ready']);
    });

    it('includes ready_selectors when provided (snake_case)', () => {
      let config = resolveReadinessConfig({
        readiness: { ready_selectors: ['.done'] }
      });
      expect(config.ready_selectors).toEqual(['.done']);
    });

    it('includes notPresentSelectors when provided (camelCase)', () => {
      let config = resolveReadinessConfig({
        readiness: { notPresentSelectors: ['.skeleton', '.spinner'] }
      });
      expect(config.not_present_selectors).toEqual(['.skeleton', '.spinner']);
    });

    it('includes not_present_selectors when provided (snake_case)', () => {
      let config = resolveReadinessConfig({
        readiness: { not_present_selectors: ['.loader'] }
      });
      expect(config.not_present_selectors).toEqual(['.loader']);
    });

    it('omits selector keys when not provided', () => {
      let config = resolveReadinessConfig({ readiness: { preset: 'balanced' } });
      expect(config.ready_selectors).toBeUndefined();
      expect(config.not_present_selectors).toBeUndefined();
    });

    it('returns balanced defaults when readiness key is missing', () => {
      let config = resolveReadinessConfig({});
      expect(config.preset).toBe('balanced');
    });
  });

  describe('waitForReadiness', () => {
    it('returns null when preset is disabled', async () => {
      let mockPage = {};
      let result = await waitForReadiness(mockPage, { readiness: { preset: 'disabled' } });
      expect(result).toBeNull();
    });

    it('calls insertPercyDom and page.eval', async () => {
      let evalCalled = false;
      let insertCalled = false;
      let mockPage = {
        insertPercyDom: async () => { insertCalled = true; },
        eval: async () => { evalCalled = true; return { passed: true, total_duration_ms: 50, checks: {} }; }
      };

      let result = await waitForReadiness(mockPage, { readiness: { preset: 'fast' } });
      expect(insertCalled).toBe(true);
      expect(evalCalled).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('logs warning when checks fail', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 10000,
          checks: {
            dom_stability: { passed: true, duration_ms: 300 },
            not_present_selectors: { passed: false, duration_ms: 10000 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Dashboard',
        readiness: { preset: 'balanced' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Warning.*Dashboard.*captured before stable/)
      ]));
    });

    it('logs tip for dom_stability failure', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 5000,
          checks: {
            dom_stability: { passed: false, duration_ms: 5000, mutations_observed: 42 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Unstable Page',
        readiness: { preset: 'fast' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/dom_stability: FAILED.*42 mutations/)
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Tip:.*notPresentSelectors/)
      ]));
    });

    it('logs tip for network_idle failure', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 10000,
          checks: {
            network_idle: { passed: false, duration_ms: 10000 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Network Test',
        readiness: { preset: 'balanced' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Tip:.*long-polling.*disallowedHostnames/)
      ]));
    });

    it('logs tip for image_ready failure', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 10000,
          checks: {
            image_ready: { passed: false, duration_ms: 10000 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Image Test',
        readiness: { preset: 'balanced' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Tip:.*imageReady: false/)
      ]));
    });

    it('logs tip for ready_selectors failure', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 10000,
          checks: {
            ready_selectors: { passed: false, duration_ms: 10000 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Selector Test',
        readiness: { preset: 'balanced' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Tip:.*selector.*not found/)
      ]));
    });

    it('logs tip for not_present_selectors failure', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 10000,
          checks: {
            not_present_selectors: { passed: false, duration_ms: 10000 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Loader Test',
        readiness: { preset: 'balanced' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Tip:.*Loading indicators still present/)
      ]));
    });

    it('logs passed check status correctly', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 10000,
          checks: {
            dom_stability: { passed: true, duration_ms: 200 },
            network_idle: { passed: false, duration_ms: 10000 }
          }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Mixed Test',
        readiness: { preset: 'balanced' }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/dom_stability: passed/)
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/network_idle: FAILED/)
      ]));
    });

    it('handles page.eval errors gracefully', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => { throw new Error('Session closed'); }
      };

      let result = await waitForReadiness(mockPage, {
        name: 'Error Test',
        readiness: { preset: 'balanced' }
      });

      expect(result.passed).toBe(false);
      expect(result.error).toBe('Session closed');
    });

    it('logs debug when checks pass', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: true,
          timed_out: false,
          total_duration_ms: 150,
          checks: { dom_stability: { passed: true, duration_ms: 100 } }
        })
      };

      await waitForReadiness(mockPage, {
        name: 'Quick Page',
        readiness: { preset: 'fast' }
      });

      // Should not log any warnings
      expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Warning/)
      ]));
    });

    it('uses snapshot name "unknown" when name not provided', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: false,
          timed_out: true,
          total_duration_ms: 5000,
          checks: { dom_stability: { passed: false, duration_ms: 5000 } }
        })
      };

      await waitForReadiness(mockPage, { readiness: { preset: 'fast' } });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/unknown.*captured before stable/)
      ]));
    });

    it('handles result with PercyDOM not available', async () => {
      let mockPage = {
        insertPercyDom: async () => {},
        eval: async () => ({
          passed: true,
          error: 'waitForReady not available',
          checks: {}
        })
      };

      let result = await waitForReadiness(mockPage, { readiness: { preset: 'balanced' } });
      expect(result.passed).toBe(true);
    });
  });

  describe('PRESETS', () => {
    it('exports balanced, strict, and fast presets', () => {
      expect(PRESETS.balanced).toBeDefined();
      expect(PRESETS.strict).toBeDefined();
      expect(PRESETS.fast).toBeDefined();
    });

    it('balanced preset has expected values', () => {
      expect(PRESETS.balanced).toEqual({
        stability_window_ms: 300,
        network_idle_window_ms: 200,
        timeout_ms: 10000,
        image_ready: true,
        font_ready: true
      });
    });

    it('strict preset has longer windows', () => {
      expect(PRESETS.strict.stability_window_ms).toBeGreaterThan(PRESETS.balanced.stability_window_ms);
      expect(PRESETS.strict.timeout_ms).toBeGreaterThan(PRESETS.balanced.timeout_ms);
    });

    it('fast preset disables image_ready', () => {
      expect(PRESETS.fast.image_ready).toBe(false);
    });
  });
});
