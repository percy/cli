import { extractLiteralMarkers, escapeForRegex } from '@percy/logger/redact/extract-markers';

describe('extractLiteralMarkers', () => {
  it('extracts a plain literal prefix', () => {
    expect(extractLiteralMarkers('AKIA[0-9A-Z]{16}')).toEqual(['AKIA']);
  });

  it('extracts the keyword from a non-capturing prefix', () => {
    expect(extractLiteralMarkers('(?:abbysale).{0,40}\\b([a-z0-9A-Z]{40})\\b'))
      .toEqual(['abbysale']);
  });

  it('extracts each branch of a top-level alternation', () => {
    // the 'A3T' branch loses the final char before [A-Z0-9] because the next token
    // is a character class, not because of a quantifier — but the walker currently
    // keeps `A3T` (3 chars, below MIN) so it is dropped; the other branches stay.
    const out = extractLiteralMarkers('(A3T[A-Z0-9]|AKIA|AGPA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}');
    expect(out).toContain('AKIA');
    expect(out).toContain('AGPA');
    expect(out).toContain('AROA');
    expect(out).toContain('AIPA');
    expect(out).toContain('ANPA');
    expect(out).toContain('ANVA');
    expect(out).toContain('ASIA');
    expect(out).not.toContain('A3T');
  });

  it('extracts two alternative literals', () => {
    expect(extractLiteralMarkers('(aws_access_key_id|aws_secret_access_key)'))
      .toEqual(['aws_access_key_id', 'aws_secret_access_key']);
  });

  it('skips character class content and picks up later literals', () => {
    // `.` unescaped is a wildcard so it breaks runs; `execute-api` and
    // `amazonaws` are literal runs. `com` is 3 chars → below MIN_MARKER_LEN.
    const out = extractLiteralMarkers('[0-9a-z]+.execute-api.[0-9a-z._-]+.amazonaws.com');
    expect(out).toContain('execute-api');
    expect(out).toContain('amazonaws');
    expect(out).not.toContain('com');
  });

  it('handles escaped dots as literal continuations', () => {
    // `mzn\.mws\.` → 'mzn.mws.' as one contiguous literal run
    expect(extractLiteralMarkers('mzn\\.mws\\.[0-9a-f]{8}'))
      .toEqual(['mzn.mws.']);
  });

  it('returns empty for pure entropy regex', () => {
    expect(extractLiteralMarkers('\\b[a-f0-9]{32}\\b')).toEqual([]);
  });

  it('drops quantified trailing literal', () => {
    // `abc?` — `c` is optional, so `abc` cannot be guaranteed to appear.
    // We must drop to `ab` which is below MIN_MARKER_LEN → empty.
    expect(extractLiteralMarkers('abc?def')).toContain('def');
    expect(extractLiteralMarkers('abc?def')).not.toContain('abc');
  });

  it('excludes noise words', () => {
    expect(extractLiteralMarkers('https://example/path/(token|pass)'))
      .not.toContain('https');
    expect(extractLiteralMarkers('https://example/path/(token|pass)'))
      .not.toContain('token');
    expect(extractLiteralMarkers('https://example/path/(token|pass)'))
      .not.toContain('pass');
  });

  it('deduplicates identical markers', () => {
    expect(extractLiteralMarkers('amazonaws.foo.amazonaws'))
      .toEqual(['amazonaws']);
  });

  it('handles a character class with embedded escape', () => {
    expect(extractLiteralMarkers('[\\w-]+')).toEqual([]);
  });

  it('handles start/end anchors without crash', () => {
    expect(extractLiteralMarkers('^prefix[0-9]+$')).toEqual(['prefix']);
  });

  it('handles empty source', () => {
    expect(extractLiteralMarkers('')).toEqual([]);
  });

  it('survives a `{n,m}` quantifier and keeps literals on either side', () => {
    expect(extractLiteralMarkers('prefix[0-9]{3,5}suffix'))
      .toEqual(['prefix', 'suffix']);
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
    expect(escapeForRegex('abbysale')).toBe('abbysale');
  });
});
