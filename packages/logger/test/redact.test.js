import {
  redactString, redactSecrets,
  extractLiteralMarkers, escapeForRegex,
  createRedactor,
  PATTERNS_COUNT, MARKER_COUNT
} from '@percy/logger/redact';

describe('redact', () => {
  describe('supply-chain integrity', () => {
    it('loaded a non-trivial pattern set', () => {
      expect(PATTERNS_COUNT).toBeGreaterThan(1500);
    });

    it('extracted markers for the majority of patterns', () => {
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

    it('is fail-open on very long input', () => {
      expect(() => redactString('a'.repeat(100000))).not.toThrow();
    });
  });

  describe('redactSecrets back-compat', () => {
    it('redacts a string', () => {
      expect(redactSecrets('secret: ASIAY34FZKBOKMUTVV7A'))
        .toBe('secret: [REDACTED]');
    });

    it('redacts object.message', () => {
      expect(redactSecrets({ message: 'secret: ASIAY34FZKBOKMUTVV7A' }))
        .toEqual({ message: 'secret: [REDACTED]' });
    });

    it('maps over arrays', () => {
      expect(redactSecrets([{ message: 'secret: ASIAY34FZKBOKMUTVV7A' }]))
        .toEqual([{ message: 'secret: [REDACTED]' }]);
    });

    it('passes primitives through unchanged', () => {
      expect(redactSecrets(42)).toBe(42);
      expect(redactSecrets(null)).toBe(null);
    });

    it('leaves an object without a message untouched', () => {
      const obj = { something: 'else' };
      expect(redactSecrets(obj)).toBe(obj);
    });
  });

  describe('createRedactor', () => {
    it('is a no-op when the pattern set is empty', () => {
      const r = createRedactor([]);
      expect(r.patternsCount).toBe(0);
      expect(r.markerCount).toBe(0);
      expect(r.redactString('AKIAIOSFODNN7EXAMPLE')).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(r.redactSecrets('plain')).toBe('plain');
      expect(r.redactSecrets({ message: 'anything' })).toEqual({ message: 'anything' });
    });

    it('runs only anchored patterns when no entropy patterns exist', () => {
      const r = createRedactor([{ pattern: { regex: 'AKIA[A-Z0-9]{10}' } }]);
      expect(r.redactString('prefix AKIABCDEFGHIJK suffix')).toBe('prefix [REDACTED] suffix');
      expect(r.redactString('no marker here')).toBe('no marker here');
    });

    it('runs only entropy patterns when no anchored patterns exist', () => {
      const r = createRedactor([{ pattern: { regex: '\\b[a-f0-9]{32}\\b' } }]);
      expect(r.redactString('hash a1b2c3d4e5f60718293a4b5c6d7e8f90 end'))
        .toBe('hash [REDACTED] end');
    });

    it('skips patterns that fail to compile', () => {
      const r = createRedactor([
        { pattern: { regex: '(invalid' } },
        { pattern: { regex: 'VALID_MARKER_XYZ' } }
      ]);
      expect(r.redactString('hit VALID_MARKER_XYZ here')).toBe('hit [REDACTED] here');
    });

    it('handles empty / non-string input on a custom redactor', () => {
      const r = createRedactor([]);
      expect(r.redactString('')).toBe('');
      expect(r.redactString(null)).toBe(null);
      expect(r.redactString(42)).toBe(42);
    });
  });
});

describe('extractLiteralMarkers', () => {
  it('extracts a plain literal prefix', () => {
    expect(extractLiteralMarkers('AKIA[0-9A-Z]{16}')).toEqual(['AKIA']);
  });

  it('extracts the keyword from a non-capturing prefix', () => {
    expect(extractLiteralMarkers('(?:abbysale).{0,40}\\b([a-z0-9A-Z]{40})\\b'))
      .toEqual(['abbysale']);
  });

  it('extracts each branch of a top-level alternation', () => {
    const out = extractLiteralMarkers('(A3T[A-Z0-9]|AKIA|AGPA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}');
    for (const m of ['AKIA', 'AGPA', 'AROA', 'AIPA', 'ANPA', 'ANVA', 'ASIA', 'A3T']) {
      expect(out).toContain(m);
    }
  });

  it('extracts two alternative literals', () => {
    expect(extractLiteralMarkers('(aws_access_key_id|aws_secret_access_key)'))
      .toEqual(['aws_access_key_id', 'aws_secret_access_key']);
  });

  it('skips character class content and picks up later literals', () => {
    const out = extractLiteralMarkers('[0-9a-z]+.execute-api.[0-9a-z._-]+.amazonaws.com');
    expect(out).toContain('execute-api');
    expect(out).toContain('amazonaws');
    expect(out).not.toContain('com');
  });

  it('handles escaped dots as literal continuations', () => {
    expect(extractLiteralMarkers('mzn\\.mws\\.[0-9a-f]{8}'))
      .toEqual(['mzn.mws.']);
  });

  it('returns empty for pure-entropy regex', () => {
    expect(extractLiteralMarkers('\\b[a-f0-9]{32}\\b')).toEqual([]);
  });

  it('drops quantified trailing literal', () => {
    expect(extractLiteralMarkers('abc?def')).toContain('def');
    expect(extractLiteralMarkers('abc?def')).not.toContain('abc');
  });

  it('excludes noise words', () => {
    const out = extractLiteralMarkers('https://example/path/(token|pass)');
    expect(out).not.toContain('https');
    expect(out).not.toContain('token');
    expect(out).not.toContain('pass');
  });

  it('deduplicates identical markers', () => {
    const out = extractLiteralMarkers('amazonaws.amazonaws.somethingelse');
    expect(out.filter(m => m === 'amazonaws').length).toBe(1);
    expect(out).toContain('amazonaws');
    expect(out).toContain('somethingelse');
  });

  it('handles a character class with embedded escape', () => {
    expect(extractLiteralMarkers('[\\w-]+')).toEqual([]);
  });

  it('handles anchors', () => {
    expect(extractLiteralMarkers('^prefix[0-9]+$')).toEqual(['prefix']);
  });

  it('handles empty source', () => {
    expect(extractLiteralMarkers('')).toEqual([]);
  });

  it('survives a `{n,m}` quantifier', () => {
    expect(extractLiteralMarkers('prefix[0-9]{3,5}suffix'))
      .toEqual(['prefix', 'suffix']);
  });

  it('handles (?<named>) capture groups', () => {
    expect(extractLiteralMarkers('(?<tag>alpha)beta'))
      .toEqual(['alpha', 'beta']);
  });

  it('handles (?P<named>) Python-style capture groups', () => {
    expect(extractLiteralMarkers('(?P<tag>alpha)beta'))
      .toEqual(['alpha', 'beta']);
  });

  it('does not hang on an unterminated (?<name> group', () => {
    expect(() => extractLiteralMarkers('(?<never')).not.toThrow();
  });
});

describe('escapeForRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeForRegex('a.b*c+')).toBe('a\\.b\\*c\\+');
    expect(escapeForRegex('(foo)')).toBe('\\(foo\\)');
    expect(escapeForRegex('[abc]')).toBe('\\[abc\\]');
  });

  it('passes plain strings through', () => {
    expect(escapeForRegex('AKIA')).toBe('AKIA');
  });
});
