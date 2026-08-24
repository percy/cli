import {
  cdpTimeout,
  pendingCommand,
  normalizeEvalException,
  DEFAULT_CDP_TIMEOUT
} from '../../src/utils.js';
import { setupTest } from '../helpers/index.js';

describe('Unit / CDP command deadlines', () => {
  beforeEach(async () => {
    await setupTest();
    delete process.env.PERCY_CDP_TIMEOUT;
  });

  afterEach(() => {
    delete process.env.PERCY_CDP_TIMEOUT;
  });

  describe('cdpTimeout', () => {
    it('defaults when nothing is configured', () => {
      expect(cdpTimeout()).toBe(DEFAULT_CDP_TIMEOUT);
    });

    it('prefers an explicit override', () => {
      process.env.PERCY_CDP_TIMEOUT = '1234';
      expect(cdpTimeout(50)).toBe(50);
    });

    it('reads PERCY_CDP_TIMEOUT', () => {
      process.env.PERCY_CDP_TIMEOUT = '4321';
      expect(cdpTimeout()).toBe(4321);
    });

    it('ignores a non-numeric PERCY_CDP_TIMEOUT', () => {
      process.env.PERCY_CDP_TIMEOUT = 'soon';
      expect(cdpTimeout()).toBe(DEFAULT_CDP_TIMEOUT);
    });

    it('allows opting out with zero', () => {
      process.env.PERCY_CDP_TIMEOUT = '0';
      expect(cdpTimeout()).toBe(0);
    });
  });

  describe('pendingCommand', () => {
    it('resolves when the response settles the callback', async () => {
      let callbacks = new Map();
      let pending = pendingCommand(callbacks, 1, 'Target.closeTarget', 10000);

      let callback = callbacks.get(1);
      clearTimeout(callback.timer);
      callbacks.delete(1);
      callback.resolve({ ok: true });

      await expectAsync(pending).toBeResolvedTo({ ok: true });
    });

    it('rejects a command the browser never answers', async () => {
      let callbacks = new Map();
      let pending = pendingCommand(callbacks, 2, 'Target.closeTarget', 50);

      await expectAsync(pending).toBeRejectedWithError(
        'Protocol error (Target.closeTarget): Timed out after 50ms');
      expect(callbacks.has(2)).toBe(false);
    });

    it('does not reject a command that settled before the deadline', async () => {
      let callbacks = new Map();
      let pending = pendingCommand(callbacks, 3, 'Runtime.callFunctionOn', 50);

      let callback = callbacks.get(3);
      clearTimeout(callback.timer);
      callbacks.delete(3);
      callback.resolve('done');

      await expectAsync(pending).toBeResolvedTo('done');
      await new Promise(r => setTimeout(r, 80));
      await expectAsync(pending).toBeResolvedTo('done');
    });

    it('never registers a deadline when disabled', async () => {
      let callbacks = new Map();
      pendingCommand(callbacks, 4, 'Page.navigate', 0);
      expect(callbacks.get(4).timer).toBeUndefined();
    });
  });

  describe('normalizeEvalException', () => {
    it('keeps an error description', () => {
      let error = normalizeEvalException({
        exception: { type: 'object', subtype: 'error', description: 'Error: boom\n    at <anonymous>' }
      });

      expect(error instanceof Error).toBe(true);
      expect(error.message).toContain('Error: boom');
    });

    it('reports a string rejection that carries no description', () => {
      let error = normalizeEvalException({
        text: 'Uncaught (in promise)',
        exception: { type: 'string', value: 'sections-one-column-layout-hero--home-page' }
      });

      expect(error instanceof Error).toBe(true);
      expect(error.message).toBe(
        'Uncaught (in promise): sections-one-column-layout-hero--home-page');
    });

    it('reports an undefined rejection instead of throwing undefined', () => {
      let error = normalizeEvalException({
        text: 'Uncaught (in promise)',
        exception: { type: 'undefined' }
      });

      expect(error instanceof Error).toBe(true);
      expect(error.message).toBe('Uncaught (in promise): undefined');
    });

    it('reports a null rejection', () => {
      let error = normalizeEvalException({
        text: 'Uncaught (in promise)',
        exception: { type: 'object', subtype: 'null', value: null }
      });

      expect(error instanceof Error).toBe(true);
      expect(error.message).toBe('Uncaught (in promise): null');
    });

    it('falls back when there are no details at all', () => {
      let error = normalizeEvalException({});

      expect(error instanceof Error).toBe(true);
      expect(error.message).toBe('Page evaluation failed: unknown');
    });
  });
});
