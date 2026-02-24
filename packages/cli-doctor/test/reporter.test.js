import {
  sectionHeader,
  checkLine,
  suggestionList,
  summaryBanner,
  renderFindings,
  sectionStatus,
  print
} from '@percy/cli-doctor/src/utils/reporter.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureOutput(fn) {
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  spyOn(process.stdout, 'write').and.callFake(chunk => { lines.push(String(chunk)); return true; });
  fn();
  return lines.join('');
}

// ─── sectionHeader ────────────────────────────────────────────────────────────

describe('sectionHeader', () => {
  it('includes the title text', () => {
    expect(sectionHeader('SSL / TLS')).toContain('SSL / TLS');
  });

  it('starts with a newline', () => {
    expect(sectionHeader('Foo')).toMatch(/^\n/);
  });
});

// ─── checkLine ────────────────────────────────────────────────────────────────

describe('checkLine', () => {
  it('uses ✔ icon for pass status', () => {
    expect(checkLine('pass', 'all good')).toContain('✔');
    expect(checkLine('pass', 'all good')).toContain('all good');
  });

  it('uses ✖ icon for fail status', () => {
    expect(checkLine('fail', 'broken')).toContain('✖');
  });

  it('uses ⚠ icon for warn status', () => {
    expect(checkLine('warn', 'careful')).toContain('⚠');
  });

  it('uses ℹ icon for info status', () => {
    expect(checkLine('info', 'note')).toContain('ℹ');
  });

  it('uses – icon for skip status', () => {
    expect(checkLine('skip', 'skipped')).toContain('–');
  });

  it('appends detail on a second line when provided', () => {
    const line = checkLine('pass', 'msg', 'extra detail');
    expect(line).toContain('extra detail');
    expect(line).toContain('\n');
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

  it('includes each suggestion prefixed with →', () => {
    const out = suggestionList(['do this', 'do that']);
    expect(out).toContain('→');
    expect(out).toContain('do this');
    expect(out).toContain('do that');
  });

  it('renders one line per suggestion', () => {
    const out = suggestionList(['a', 'b', 'c']);
    expect(out.split('\n').filter(Boolean).length).toBe(3);
  });
});

// ─── summaryBanner ────────────────────────────────────────────────────────────

describe('summaryBanner', () => {
  it('shows all-passed message when no failures or warnings', () => {
    expect(summaryBanner(5, 0, 0)).toContain('passed');
  });

  it('shows fail count when failures exist', () => {
    expect(summaryBanner(2, 1, 3)).toContain('3');
  });

  it('shows warning message when only warnings', () => {
    expect(summaryBanner(4, 2, 0)).toContain('warning');
  });
});

// ─── renderFindings ───────────────────────────────────────────────────────────

describe('renderFindings', () => {
  let tally;

  beforeEach(() => {
    tally = { pass: 0, warn: 0, fail: 0 };
  });

  it('increments tally.pass for pass findings', () => {
    const findings = [{ status: 'pass', message: 'ok' }];
    captureOutput(() => renderFindings(findings, null, tally));
    expect(tally.pass).toBe(1);
  });

  it('increments tally.warn for warn findings', () => {
    const findings = [{ status: 'warn', message: 'careful' }];
    captureOutput(() => renderFindings(findings, null, tally));
    expect(tally.warn).toBe(1);
  });

  it('increments tally.fail for fail findings', () => {
    const findings = [{ status: 'fail', message: 'broken' }];
    captureOutput(() => renderFindings(findings, null, tally));
    expect(tally.fail).toBe(1);
  });

  it('renders messages to stdout', () => {
    const findings = [
      { status: 'pass', message: 'connectivity ok' },
      { status: 'fail', message: 'ssl broken', suggestions: ['fix it'] }
    ];
    const out = captureOutput(() => renderFindings(findings, null, tally));
    expect(out).toContain('connectivity ok');
    expect(out).toContain('ssl broken');
    expect(out).toContain('fix it');
  });

  it('handles findings with no suggestions gracefully', () => {
    const findings = [{ status: 'info', message: 'no suggestions here' }];
    expect(() => captureOutput(() => renderFindings(findings, null, tally))).not.toThrow();
  });
});

// ─── sectionStatus ────────────────────────────────────────────────────────────

describe('sectionStatus', () => {
  it('returns fail when any finding is fail', () => {
    expect(sectionStatus([
      { status: 'pass' }, { status: 'fail' }, { status: 'warn' }
    ])).toBe('fail');
  });

  it('returns warn when highest is warn', () => {
    expect(sectionStatus([
      { status: 'pass' }, { status: 'warn' }
    ])).toBe('warn');
  });

  it('returns pass when all pass', () => {
    expect(sectionStatus([
      { status: 'pass' }, { status: 'pass' }
    ])).toBe('pass');
  });

  it('returns info for empty array', () => {
    expect(sectionStatus([])).toBe('info');
  });

  it('returns info for all-info findings', () => {
    expect(sectionStatus([{ status: 'info' }])).toBe('info');
  });
});

// ─── print ────────────────────────────────────────────────────────────────────

describe('print', () => {
  it('writes text + newline to stdout', () => {
    const lines = [];
    spyOn(process.stdout, 'write').and.callFake(chunk => { lines.push(String(chunk)); return true; });
    print(null, 'hello world');
    expect(lines.join('')).toContain('hello world');
  });

  it('does not write when text is empty', () => {
    const writes = [];
    spyOn(process.stdout, 'write').and.callFake(chunk => { writes.push(chunk); return true; });
    print(null, '');
    expect(writes.length).toBe(0);
  });
});
