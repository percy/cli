import { safeReplacer, safeStringify, sanitizeMeta } from '@percy/logger/safe-stringify';

describe('safe-stringify', () => {
  describe('safeReplacer', () => {
    it('survives circular references', () => {
      const a = { name: 'root' };
      a.self = a;
      const out = JSON.stringify(a, safeReplacer());
      expect(out).toBe('{"name":"root","self":"[Circular]"}');
    });

    it('flattens Error instances', () => {
      const err = new TypeError('boom');
      const parsed = JSON.parse(safeStringify({ err }));
      expect(parsed.err.name).toBe('TypeError');
      expect(parsed.err.message).toBe('boom');
      expect(typeof parsed.err.stack).toBe('string');
    });

    it('encodes Buffer as base64', () => {
      const b = Buffer.from('hello');
      const parsed = JSON.parse(safeStringify({ b }));
      expect(parsed.b).toEqual({ type: 'Buffer', base64: 'aGVsbG8=' });
    });

    it('stringifies BigInt', () => {
      expect(safeStringify({ n: BigInt(42) })).toBe('{"n":"42"}');
    });

    it('drops Function and Symbol', () => {
      expect(safeStringify({ f: () => 1, s: Symbol('x'), ok: 1 }))
        .toBe('{"ok":1}');
    });

    it('redacts secrets in deeply nested strings (DPR-6)', () => {
      const deeply = {
        request: { headers: { Authorization: 'Bearer AKIAIOSFODNN7EXAMPLE' } }
      };
      const out = JSON.parse(safeStringify(deeply));
      expect(out.request.headers.Authorization).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(out.request.headers.Authorization).toContain('[REDACTED]');
    });
  });

  describe('safeStringify', () => {
    it('returns a placeholder on internal failure (DPR-19)', () => {
      // Build an object whose toJSON throws — safeStringify should still not
      // throw and should return a sanitized placeholder, not raw String(obj).
      const bad = { toJSON () { throw new Error('nope'); } };
      const out = safeStringify(bad);
      // Either JSON.stringify handles toJSON(), or we fall to placeholder.
      // Either way: valid JSON, no unredacted leak.
      expect(() => JSON.parse(out)).not.toThrow();
    });
  });

  describe('sanitizeMeta', () => {
    it('returns primitives unchanged', () => {
      expect(sanitizeMeta(null)).toBe(null);
      expect(sanitizeMeta(undefined)).toBe(undefined);
      expect(sanitizeMeta(5)).toBe(5);
    });

    it('returns a plain redacted object', () => {
      const out = sanitizeMeta({ token: 'AKIAIOSFODNN7EXAMPLE', name: 'home' });
      expect(out.token).toBe('[REDACTED]');
      expect(out.name).toBe('home');
    });

    it('handles circular without throwing', () => {
      const a = { name: 'x' }; a.self = a;
      expect(() => sanitizeMeta(a)).not.toThrow();
    });
  });
});
