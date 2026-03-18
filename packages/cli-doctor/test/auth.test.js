/**
 * Tests for packages/cli-doctor/src/checks/auth.js
 *
 * Mocks GET /api/v1/token — the single endpoint that returns project-token-type
 * and role (master / read_only / write_only) directly from the Percy API.
 * No client-side prefix splitting is performed.
 */

import { checkAuth } from '../src/checks/auth.js';
import { HttpProber } from '../src/utils/http.js';
import { createHttpServer, withEnv } from './helpers.js';

describe('checkAuth', () => {
  let mockApiUrl, closeServer;

  // Token → { status, body } map used by the mock server.
  const TOKEN_RESPONSES = {
    invalid_token: { status: 401, body: { errors: [{ status: 'unauthorized', detail: 'Authentication required.' }] } },
    forbidden_token: { status: 403, body: { errors: [{ status: 'forbidden', detail: 'invalid request' }] } },
    weird_token: { status: 500, body: {} },
    web_master: {
      status: 200,
      body: { data: { type: 'tokens', id: '1', attributes: { token: '***', role: 'master', 'project-token-type': 'web' } } }
    },
    web_read_only: {
      status: 200,
      body: { data: { type: 'tokens', id: '2', attributes: { token: '***', role: 'read_only', 'project-token-type': 'web' } } }
    },
    web_write_only: {
      status: 200,
      body: { data: { type: 'tokens', id: '3', attributes: { token: '***', role: 'write_only', 'project-token-type': 'web' } } }
    },
    app_master: {
      status: 200,
      body: { data: { type: 'tokens', id: '4', attributes: { token: '***', role: 'master', 'project-token-type': 'app' } } }
    },
    auto_master: {
      status: 200,
      body: { data: { type: 'tokens', id: '5', attributes: { token: '***', role: 'master', 'project-token-type': 'automate' } } }
    },
    malformed_body_token: { status: 200, body: null }
  };

  beforeAll(async () => {
    ({ url: mockApiUrl, close: closeServer } = await createHttpServer((req, res) => {
      const auth = req.headers.authorization ?? '';
      if (!auth.startsWith('Token token=')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ status: 'unauthorized' }] }));
        return;
      }
      const token = auth.replace('Token token=', '');
      const spec = TOKEN_RESPONSES[token];
      if (!spec) {
        // Unknown token — treat as valid project token (200 web/master default)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: { type: 'tokens', id: '99', attributes: { token: '***', role: 'master', 'project-token-type': 'web' } }
        }));
        return;
      }
      res.writeHead(spec.status, { 'Content-Type': 'application/json' });
      res.end(spec.body ? JSON.stringify(spec.body) : '');
    }));
  });

  afterAll(() => closeServer());

  async function check(token, opts = {}) {
    return withEnv(
      { PERCY_TOKEN: token },
      () => checkAuth({ timeout: 5000, apiBaseUrl: mockApiUrl, ...opts })
    );
  }

  // ── Token presence ────────────────────────────────────────────────────────

  it('returns PERCY-DR-001 fail when PERCY_TOKEN is not set', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () => checkAuth());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-001');
    expect(findings[0].status).toBe('fail');
    expect(findings[0].message).toContain('PERCY_TOKEN is not set');
  });

  it('returns PERCY-DR-001 fail when PERCY_TOKEN is empty string', async () => {
    const findings = await withEnv({ PERCY_TOKEN: '' }, () => checkAuth());
    expect(findings[0].code).toBe('PERCY-DR-001');
    expect(findings[0].status).toBe('fail');
  });

  it('returns PERCY-DR-001 fail when PERCY_TOKEN is whitespace only', async () => {
    const findings = await withEnv({ PERCY_TOKEN: '   ' }, () => checkAuth());
    expect(findings[0].code).toBe('PERCY-DR-001');
    expect(findings[0].status).toBe('fail');
  });

  it('includes helpful suggestions for missing token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () => checkAuth());
    expect(findings[0].suggestions).toContain('Set PERCY_TOKEN in your environment: export PERCY_TOKEN=<your-token>');
    expect(findings[0].suggestions).toContain('In CI, add PERCY_TOKEN as a secret environment variable.');
  });

  // ── Successful authentication (200) ──────────────────────────────────────

  it('returns PERCY-DR-002 info and PERCY-DR-003 pass for web/master token', async () => {
    const findings = await check('web_master');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    const pass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(info).toBeDefined();
    expect(info.status).toBe('info');
    expect(info.message).toContain('web');
    expect(info.metadata.projectTokenType).toBe('web');
    expect(info.metadata.role).toBe('master');
    expect(pass).toBeDefined();
    expect(pass.status).toBe('pass');
    expect(pass.message).toContain('role: master');
  });

  it('DR-002 suggests percy exec for web token type', async () => {
    const findings = await check('web_master');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info.message).toContain('percy exec');
  });

  it('DR-002 suggests percy app:exec for app token type', async () => {
    const findings = await check('app_master');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info.message).toContain('percy app:exec');
    expect(info.metadata.projectTokenType).toBe('app');
  });

  it('DR-002 reports automate project type', async () => {
    const findings = await check('auto_master');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info.metadata.projectTokenType).toBe('automate');
    expect(info.metadata.role).toBe('master');
  });

  // ── Role-based messaging ──────────────────────────────────────────────────

  it('DR-003 pass with read_only role includes warning suggestion', async () => {
    const findings = await check('web_read_only');
    const pass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(pass).toBeDefined();
    expect(pass.status).toBe('pass');
    expect(pass.message).toContain('role: read_only');
    expect(pass.suggestions).toBeDefined();
    expect(pass.suggestions.some(s => s.includes('write_only') || s.includes('master'))).toBe(true);
  });

  it('DR-003 pass with write_only role includes informational suggestion', async () => {
    const findings = await check('web_write_only');
    const pass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(pass).toBeDefined();
    expect(pass.status).toBe('pass');
    expect(pass.message).toContain('role: write_only');
    expect(pass.suggestions).toBeDefined();
    expect(pass.suggestions.some(s => s.includes('read results'))).toBe(true);
  });

  it('DR-003 pass with master role has no suggestions', async () => {
    const findings = await check('web_master');
    const pass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(pass).toBeDefined();
    expect(pass.suggestions).toBeUndefined();
  });

  // ── Authentication failures ───────────────────────────────────────────────

  it('returns PERCY-DR-004 fail when token gets 401', async () => {
    const findings = await check('invalid_token');
    const fail = findings.find(f => f.code === 'PERCY-DR-004');
    expect(fail).toBeDefined();
    expect(fail.status).toBe('fail');
    expect(fail.message).toContain('401');
    expect(fail.suggestions.length).toBeGreaterThan(0);
  });

  it('returns PERCY-DR-004 fail when token gets 403', async () => {
    const findings = await check('forbidden_token');
    const fail = findings.find(f => f.code === 'PERCY-DR-004');
    expect(fail).toBeDefined();
    expect(fail.status).toBe('fail');
    expect(fail.message).toContain('403');
  });

  it('includes suggestions for 401 auth failure', async () => {
    const findings = await check('invalid_token');
    const fail = findings.find(f => f.code === 'PERCY-DR-004');
    expect(fail.suggestions.some(s => s.includes('expired'))).toBe(true);
    expect(fail.suggestions.some(s => s.includes('Project Settings'))).toBe(true);
  });

  it('returns PERCY-DR-005 warn for unexpected HTTP status', async () => {
    const findings = await check('weird_token');
    const warn = findings.find(f => f.code === 'PERCY-DR-005');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('unexpected HTTP');
  });

  it('returns PERCY-DR-006 warn when API is unreachable', async () => {
    const findings = await withEnv(
      { PERCY_TOKEN: 'web_test_token' },
      () => checkAuth({ timeout: 1000, apiBaseUrl: 'http://127.0.0.1:1' })
    );
    const networkWarn = findings.find(f => f.code === 'PERCY-DR-006');
    expect(networkWarn).toBeDefined();
    expect(networkWarn.status).toBe('warn');
    expect(networkWarn.message).toContain('could not reach Percy API');
    expect(networkWarn.suggestions.some(s => s.includes('network issue'))).toBe(true);
  });

  it('handles malformed JSON body gracefully — still passes auth', async () => {
    const findings = await check('malformed_body_token');
    const pass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(pass).toBeDefined();
    expect(pass.status).toBe('pass');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info.metadata.projectTokenType).toBe('unknown');
    expect(info.metadata.role).toBe('unknown');
  });

  // ── SECURITY: token never in output ──────────────────────────────────────

  it('never includes token value in any finding message', async () => {
    const token = 'web_master';
    const findings = await check(token);
    const allText = findings.map(f =>
      `${f.message} ${(f.suggestions || []).join(' ')}`
    ).join(' ');
    // The raw token string must not appear anywhere
    expect(allText).not.toContain('web_master');
  });

  it('sanitizes raw token value from error messages in non-standard formats', async () => {
    const token = 'web_leaked_in_error_msg';
    const findings = await withEnv(
      { PERCY_TOKEN: token },
      () => checkAuth({ timeout: 1000, apiBaseUrl: 'http://127.0.0.1:1' })
    );
    const allText = findings.map(f =>
      `${f.message} ${(f.suggestions || []).join(' ')}`
    ).join(' ');
    expect(allText).not.toContain('leaked_in_error');
    expect(allText).not.toContain(token);
  });

  // ── Outer catch — prober throws unexpectedly ──────────────────────────────

  it('returns PERCY-DR-006 warn when probeUrl throws instead of returning', async () => {
    spyOn(HttpProber.prototype, 'probeUrl').and.rejectWith(new Error('socket hang up'));
    const findings = await withEnv(
      { PERCY_TOKEN: 'any_token' },
      () => checkAuth()
    );
    const warn = findings.find(f => f.code === 'PERCY-DR-006');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('warn');
    expect(warn.message).toContain('could not reach Percy API');
    expect(warn.suggestions.some(s => s.includes('network issue'))).toBe(true);
  });
});
