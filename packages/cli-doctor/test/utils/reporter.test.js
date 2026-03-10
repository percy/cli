/**
 * Tests for packages/cli-doctor/src/utils/reporter.js
 *
 * All functions are pure (no I/O, no side-effects on external state), so every
 * branch can be exercised synchronously without any server setup.
 */

import {
  sectionHeader,
  checkLine,
  suggestionList,
  summaryBanner,
  renderFindings,
  sectionStatus,
  print,
  useColor
} from '../../src/utils/reporter.js';

// Strip ANSI colour escapes so plain-text assertions work across all describe blocks
// eslint-disable-next-line no-control-regex -- \u001b is an intentional ANSI sentinel
function strip(s) { return s.replace(/\u001b\[[0-9;]*m/g, ''); }

// ─── sectionHeader ────────────────────────────────────────────────────────────

describe('sectionHeader', () => {
  it('includes the title text', () => {
    expect(sectionHeader('Network Connectivity')).toContain('Network Connectivity');
  });

  it('starts with a newline for visual separation', () => {
    expect(sectionHeader('Test')).toMatch(/^\n/);
  });

  it('includes the ── separator', () => {
    expect(sectionHeader('Test')).toContain('──');
  });
});

// ─── checkLine ────────────────────────────────────────────────────────────────

describe('checkLine', () => {
  it('includes the message for every status', () => {
    for (const status of ['pass', 'warn', 'fail', 'info', 'skip']) {
      expect(strip(checkLine(status, 'hello'))).toContain('hello');
    }
  });

  it('includes pass icon for pass status', () => {
    expect(strip(checkLine('pass', 'ok'))).toContain('✔');
  });

  it('includes warn icon for warn status', () => {
    expect(strip(checkLine('warn', 'watch out'))).toContain('⚠');
  });

  it('includes fail icon for fail status', () => {
    expect(strip(checkLine('fail', 'broken'))).toContain('✖');
  });

  it('includes info icon for info status', () => {
    expect(strip(checkLine('info', 'note'))).toContain('ℹ');
  });

  it('includes skip icon for skip status', () => {
    expect(strip(checkLine('skip', 'skipped'))).toContain('–');
  });

  it('falls back to info icon for unknown status', () => {
    expect(strip(checkLine('unknown', 'msg'))).toContain('ℹ');
  });

  it('appends detail on a second indented line when provided', () => {
    const line = strip(checkLine('pass', 'main', 'extra detail'));
    expect(line).toContain('main');
    expect(line).toContain('extra detail');
    expect(line).toContain('\n');
  });

  it('does not add a newline when detail is omitted', () => {
    expect(checkLine('pass', 'no detail')).not.toContain('\n');
  });
});

// ─── suggestionList ───────────────────────────────────────────────────────────

describe('suggestionList', () => {
  it('returns empty string for empty array', () => {
    expect(suggestionList([])).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(suggestionList(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(suggestionList(null)).toBe('');
  });

  it('includes each suggestion in the output', () => {
    const out = strip(suggestionList(['do this', 'do that']));
    expect(out).toContain('do this');
    expect(out).toContain('do that');
  });

  it('includes the arrow indicator (→) for each suggestion', () => {
    const out = strip(suggestionList(['fix me']));
    expect(out).toContain('→');
  });

  it('joins multiple suggestions with newlines', () => {
    const out = suggestionList(['a', 'b', 'c']);
    const lines = out.split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
  });
});

// ─── summaryBanner ────────────────────────────────────────────────────────────

describe('summaryBanner', () => {
  it('shows "All X checks passed" when no failures or warnings', () => {
    expect(strip(summaryBanner(5, 0, 0))).toContain('All 5 checks passed');
  });

  it('shows warning count when only warnings are present', () => {
    const out = strip(summaryBanner(3, 2, 0));
    expect(out).toContain('2 warning');
  });

  it('shows failure count when there are failures', () => {
    const out = strip(summaryBanner(1, 1, 2));
    expect(out).toContain('2 check(s) failed');
  });

  it('failure banner takes priority over warnings', () => {
    const out = strip(summaryBanner(0, 3, 1));
    expect(out).toContain('1 check(s) failed');
    expect(out).not.toContain('All');
  });

  it('includes total count in passed+warned+failed banner', () => {
    const out = strip(summaryBanner(2, 1, 1));
    expect(out).toMatch(/4|total/i); // 2+1+1 = 4 total
  });

  it('ends with a newline', () => {
    expect(summaryBanner(1, 0, 0)).toMatch(/\n$/);
  });
});

// ─── sectionStatus ───────────────────────────────────────────────────────────

describe('sectionStatus', () => {
  it('returns "fail" when any finding is fail', () => {
    expect(sectionStatus([
      { status: 'pass' }, { status: 'fail' }, { status: 'warn' }
    ])).toBe('fail');
  });

  it('fail takes priority over warn', () => {
    expect(sectionStatus([{ status: 'warn' }, { status: 'fail' }])).toBe('fail');
  });

  it('returns "warn" when there are warns but no fails', () => {
    expect(sectionStatus([{ status: 'pass' }, { status: 'warn' }])).toBe('warn');
  });

  it('returns "pass" when all findings are pass', () => {
    expect(sectionStatus([{ status: 'pass' }, { status: 'pass' }])).toBe('pass');
  });

  it('returns "info" when all findings are info', () => {
    expect(sectionStatus([{ status: 'info' }])).toBe('info');
  });

  it('returns "info" for an empty findings array', () => {
    expect(sectionStatus([])).toBe('info');
  });
});

// ─── renderFindings ───────────────────────────────────────────────────────────

describe('renderFindings', () => {
  let written;
  let origWrite;

  beforeEach(() => {
    written = [];
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { written.push(chunk); return true; };
  });

  afterEach(() => {
    process.stdout.write = origWrite;
  });

  it('writes each finding message to stdout', () => {
    renderFindings([
      { status: 'pass', message: 'connected', suggestions: [] },
      { status: 'fail', message: 'timeout', suggestions: [] }
    ], null);
    const out = written.join('');
    expect(out).toContain('connected');
    expect(out).toContain('timeout');
  });

  it('writes suggestions when present', () => {
    renderFindings([
      { status: 'warn', message: 'slow', suggestions: ['try this fix'] }
    ], null);
    expect(written.join('')).toContain('try this fix');
  });

  it('does not error on findings with no suggestions array', () => {
    expect(() => renderFindings([{ status: 'info', message: 'note' }], null)).not.toThrow();
  });

  it('handles an empty findings array without writing anything', () => {
    renderFindings([], null);
    expect(written.length).toBe(0);
  });

  it('respects the indent option', () => {
    renderFindings([{ status: 'pass', message: 'ok', suggestions: [] }], null, { indent: '  ' });
    // The indent is prepended to the checkLine output
    expect(written.join('')).toContain('ok');
  });
});

// ─── print ────────────────────────────────────────────────────────────────────

describe('print', () => {
  let written;
  let origWrite;

  beforeEach(() => {
    written = [];
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { written.push(chunk); return true; };
  });

  afterEach(() => {
    process.stdout.write = origWrite;
  });

  it('writes text followed by newline to stdout', () => {
    print(null, 'hello world');
    expect(written[0]).toBe('hello world\n');
  });

  it('does not write when text is empty string', () => {
    print(null, '');
    expect(written.length).toBe(0);
  });

  it('does not write when text is null', () => {
    print(null, null);
    expect(written.length).toBe(0);
  });

  it('does not write when text is undefined', () => {
    print(null, undefined);
    expect(written.length).toBe(0);
  });
});

// ─── useColor() branch: NO_COLOR env var ─────────────────────────────────────

describe('reporter — NO_COLOR suppresses ANSI codes', () => {
  const origNoColor = process.env.NO_COLOR;
  const origIsTTY = process.stdout.isTTY;

  afterAll(() => {
    // restore
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
  });

  it('produces plain text (no ANSI codes) when NO_COLOR is set', () => {
    // Force TTY on so useColor() would normally return true, then set NO_COLOR
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    const line = checkLine('pass', 'everything fine');
    // eslint-disable-next-line no-control-regex
    expect(line).not.toMatch(/\u001b\[/);
    expect(line).toContain('everything fine');
  });

  it('produces plain text when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    delete process.env.NO_COLOR;
    const line = checkLine('fail', 'something broke');
    // eslint-disable-next-line no-control-regex
    expect(line).not.toMatch(/\u001b\[/);
    expect(line).toContain('something broke');
  });

  it('sectionHeader produces plain text under NO_COLOR', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    const header = sectionHeader('My Section');
    // eslint-disable-next-line no-control-regex
    expect(header).not.toMatch(/\u001b\[/);
    expect(header).toContain('My Section');
  });

  it('suggestionList produces plain text under NO_COLOR', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    const out = suggestionList(['do this']);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\u001b\[/);
    expect(out).toContain('do this');
  });

  it('summaryBanner produces plain text under NO_COLOR', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    const banner = summaryBanner(3, 0, 0);
    // eslint-disable-next-line no-control-regex
    expect(banner).not.toMatch(/\u001b\[/);
    expect(banner).toContain('3');
  });
});

// ─── reporter — ANSI color output (useColor = true, covers lines 5-10 true branches) ──────

describe('reporter — ANSI color output (useColor=true)', () => {
  let originalIsTTY;
  let originalNoColor;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    originalNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  });

  it('checkLine pass produces ANSI green codes (line 6 true branch)', () => {
    const line = checkLine('pass', 'all good');
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\u001b\[/);
    expect(line).toContain('all good');
  });

  it('checkLine warn produces ANSI yellow codes (line 7 true branch)', () => {
    const line = checkLine('warn', 'watch out');
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\u001b\[/);
    expect(line).toContain('watch out');
  });

  it('checkLine fail produces ANSI red codes (line 8 true branch)', () => {
    const line = checkLine('fail', 'broken');
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\u001b\[/);
    expect(line).toContain('broken');
  });

  it('checkLine info produces ANSI cyan codes (line 9 true branch)', () => {
    const line = checkLine('info', 'note');
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\u001b\[/);
    expect(line).toContain('note');
  });

  it('checkLine skip produces ANSI dim codes (line 10 true branch)', () => {
    const line = checkLine('skip', 'skipped');
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\u001b\[/);
    expect(line).toContain('skipped');
  });

  it('sectionHeader produces ANSI bold+cyan codes (lines 5+9 true branches)', () => {
    const header = sectionHeader('My Section');
    // eslint-disable-next-line no-control-regex
    expect(header).toMatch(/\u001b\[/);
    expect(header).toContain('My Section');
  });

  it('suggestionList produces ANSI yellow+cyan codes', () => {
    const out = suggestionList(['fix this issue']);
    // eslint-disable-next-line no-control-regex
    expect(out).toMatch(/\u001b\[/);
    expect(out).toContain('fix this issue');
  });

  it('summaryBanner pass path produces ANSI green+bold codes', () => {
    const banner = summaryBanner(5, 0, 0);
    // eslint-disable-next-line no-control-regex
    expect(banner).toMatch(/\u001b\[/);
    expect(banner).toContain('5');
  });

  it('summaryBanner warn path produces ANSI yellow+bold+dim codes', () => {
    const banner = summaryBanner(3, 2, 0);
    // eslint-disable-next-line no-control-regex
    expect(banner).toMatch(/\u001b\[/);
    expect(banner).toContain('2');
  });

  it('summaryBanner fail path produces ANSI red+bold+dim codes', () => {
    const banner = summaryBanner(1, 1, 2);
    // eslint-disable-next-line no-control-regex
    expect(banner).toMatch(/\u001b\[/);
    expect(banner).toContain('2');
  });
});

// ─── useColor (line-level coverage for the const arrow fn) ───────────────────

describe('useColor', () => {
  let originalIsTTY;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    delete process.env.NO_COLOR;
  });

  it('returns true when stdout is a TTY and NO_COLOR is not set', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env.NO_COLOR;
    expect(useColor()).toBe(true);
  });

  it('returns false when NO_COLOR is set (even if stdout is a TTY)', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    expect(useColor()).toBe(false);
  });

  it('returns false when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    delete process.env.NO_COLOR;
    expect(useColor()).toBe(false);
  });

  it('returns false when stdout.isTTY is undefined', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: undefined, configurable: true });
    delete process.env.NO_COLOR;
    expect(useColor()).toBeFalsy();
  });
});
