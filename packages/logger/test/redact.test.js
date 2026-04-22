import { redactString, redactSecrets, PATTERNS_COUNT, MARKER_COUNT } from '@percy/logger/redact';

describe('redact', () => {
  describe('supply-chain integrity (DPR-21)', () => {
    it('loaded a non-trivial pattern set', () => {
      // If secret-patterns.json is accidentally truncated or replaced, this
      // fires before redaction silently becomes a no-op.
      expect(PATTERNS_COUNT).toBeGreaterThan(1500);
    });

    it('extracted markers for the majority of patterns', () => {
      // Most patterns have literal prefixes; this guards against extract-markers
      // regressing and making the fast-path degenerate.
      expect(MARKER_COUNT).toBeGreaterThan(500);
    });
  });

  describe('redactString', () => {
    it('redacts an AWS-shaped secret', () => {
      expect(redactString('key=AKIAIOSFODNN7EXAMPLE trailing'))
        .toBe('key=[REDACTED] trailing');
    });

    it('returns clean lines unchanged', () => {
      const clean = 'Received snapshot: home';
      expect(redactString(clean)).toBe(clean);
    });

    it('handles empty / non-string input', () => {
      expect(redactString('')).toBe('');
      expect(redactString(null)).toBe(null);
      expect(redactString(undefined)).toBe(undefined);
      expect(redactString(42)).toBe(42);
    });

    it('is fail-open on invalid input structures', () => {
      // A pathological input should never throw — the logger must not silence
      // logs because of a redact bug.
      expect(() => redactString('a'.repeat(100000))).not.toThrow();
    });
  });

  describe('redactSecrets (back-compat surface)', () => {
    it('redacts a string', () => {
      expect(redactSecrets('This is a secret: ASIAY34FZKBOKMUTVV7A'))
        .toBe('This is a secret: [REDACTED]');
    });

    it('redacts object.message', () => {
      expect(redactSecrets({ message: 'This is a secret: ASIAY34FZKBOKMUTVV7A' }))
        .toEqual({ message: 'This is a secret: [REDACTED]' });
    });

    it('maps over arrays', () => {
      expect(redactSecrets([{ message: 'This is a secret: ASIAY34FZKBOKMUTVV7A' }]))
        .toEqual([{ message: 'This is a secret: [REDACTED]' }]);
    });
  });
});
