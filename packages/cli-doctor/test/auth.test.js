/**
 * Tests for packages/cli-doctor/src/checks/auth.js
 *
 * Spins up in-process HTTP servers to mock the Percy API token endpoint.
 * No external network access required.
 */

import { checkAuth } from '../src/checks/auth.js';
import { createHttpServer, withEnv } from './helpers.js';

describe('checkAuth', () => {
  let mockApiUrl, closeServer;

  // Start a mock Percy API server that responds based on the Authorization header
  beforeAll(async () => {
    ({ url: mockApiUrl, close: closeServer } = await createHttpServer((req, res) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Token token=')) {
        res.writeHead(401);
        res.end();
        return;
      }
      const token = auth.replace('Token token=', '');
      if (token === 'invalid_token') {
        res.writeHead(401);
        res.end();
      } else if (token.startsWith('auto_') || token.startsWith('web_') || token.startsWith('app_')) {
        // Project tokens get 403 (valid auth, but not user token)
        res.writeHead(403);
        res.end();
      } else if (token === 'user_master_token') {
        // User tokens get 200
        res.writeHead(200);
        res.end(JSON.stringify({ data: [] }));
      } else if (token === 'weird_status_token') {
        // Simulate unexpected status
        res.writeHead(500);
        res.end();
      } else {
        // Default: treat as project token
        res.writeHead(403);
        res.end();
      }
    }));
  });

  afterAll(() => closeServer());

  // Helper that patches the auth check to use our mock server
  async function checkAuthWithMock(token, opts = {}) {
    return withEnv(
      { PERCY_TOKEN: token },
      () => checkAuth({ timeout: 5000, apiBaseUrl: mockApiUrl, ...opts })
    );
  }

  // ── Token presence ──────────────────────────────────────────────────────────

  it('returns PERCY-DR-001 fail when PERCY_TOKEN is not set', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () => checkAuth());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-001');
    expect(findings[0].status).toBe('fail');
    expect(findings[0].message).toContain('PERCY_TOKEN is not set');
  });

  it('returns PERCY-DR-001 fail when PERCY_TOKEN is empty string', async () => {
    const findings = await withEnv({ PERCY_TOKEN: '' }, () => checkAuth());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-001');
    expect(findings[0].status).toBe('fail');
  });

  it('returns PERCY-DR-001 fail when PERCY_TOKEN is whitespace only', async () => {
    const findings = await withEnv({ PERCY_TOKEN: '   ' }, () => checkAuth());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('PERCY-DR-001');
    expect(findings[0].status).toBe('fail');
  });

  // ── Token format / prefix ───────────────────────────────────────────────────

  it('detects automate project type from auto_ prefix', async () => {
    const findings = await checkAuthWithMock('auto_abc123');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.message).toContain('automate');
    expect(info.metadata.tokenType).toBe('automate');
  });

  it('detects app project type from app_ prefix', async () => {
    const findings = await checkAuthWithMock('app_abc123');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.message).toContain('app');
    expect(info.message).toContain('percy app:exec');
  });

  it('detects web project type from web_ prefix', async () => {
    const findings = await checkAuthWithMock('web_abc123');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.message).toContain('web');
    expect(info.message).toContain('percy exec');
  });

  it('defaults to web for unknown prefix', async () => {
    const findings = await checkAuthWithMock('unknown_prefix_token');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.metadata.tokenType).toBe('web');
  });

  it('detects generic project type from ss_ prefix', async () => {
    const findings = await checkAuthWithMock('ss_abc123');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.metadata.tokenType).toBe('generic');
  });

  it('detects visual_scanner project type from vmw_ prefix', async () => {
    const findings = await checkAuthWithMock('vmw_abc123');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.metadata.tokenType).toBe('visual_scanner');
  });

  it('detects responsive_scanner project type from res_ prefix', async () => {
    const findings = await checkAuthWithMock('res_abc123');
    const info = findings.find(f => f.code === 'PERCY-DR-002');
    expect(info).toBeDefined();
    expect(info.metadata.tokenType).toBe('responsive_scanner');
  });

  // ── Token auth API responses ─────────────────────────────────────────────────

  it('returns PERCY-DR-003 pass when project token gets 403', async () => {
    const findings = await checkAuthWithMock('web_valid_project_token');
    const authPass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(authPass).toBeDefined();
    expect(authPass.status).toBe('pass');
    expect(authPass.message).toContain('Token authentication successful');
  });

  it('returns PERCY-DR-003 pass when user token gets 200', async () => {
    const findings = await checkAuthWithMock('user_master_token');
    const authPass = findings.find(f => f.code === 'PERCY-DR-003');
    expect(authPass).toBeDefined();
    expect(authPass.status).toBe('pass');
    expect(authPass.message).toContain('Token authentication successful');
  });

  it('returns PERCY-DR-004 fail when token gets 401', async () => {
    const findings = await checkAuthWithMock('invalid_token');
    const authFail = findings.find(f => f.code === 'PERCY-DR-004');
    expect(authFail).toBeDefined();
    expect(authFail.status).toBe('fail');
    expect(authFail.message).toContain('401');
    expect(authFail.suggestions.length).toBeGreaterThan(0);
  });

  it('returns PERCY-DR-005 warn for unexpected HTTP status', async () => {
    const findings = await checkAuthWithMock('weird_status_token');
    const authWarn = findings.find(f => f.code === 'PERCY-DR-005');
    expect(authWarn).toBeDefined();
    expect(authWarn.status).toBe('warn');
    expect(authWarn.message).toContain('unexpected HTTP');
  });

  it('returns PERCY-DR-006 warn when API is unreachable', async () => {
    // Use an unreachable URL to simulate network failure
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

  // ── SECURITY: token never in output ─────────────────────────────────────────

  it('never includes token value or prefix in any finding message', async () => {
    const token = 'auto_secret_value_12345';
    const findings = await checkAuthWithMock(token);
    const allText = findings.map(f =>
      `${f.message} ${(f.suggestions || []).join(' ')}`
    ).join(' ');

    expect(allText).not.toContain('auto_secret');
    expect(allText).not.toContain('secret_value');
    expect(allText).not.toContain('12345');
  });

  it('sanitizes raw token value from error messages even in non-standard formats', async () => {
    const token = 'web_leaked_in_error_msg';
    // Network error path — error message may contain the token in any format
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

  // ── Suggestions ─────────────────────────────────────────────────────────────

  it('includes helpful suggestions for missing token', async () => {
    const findings = await withEnv({ PERCY_TOKEN: undefined }, () => checkAuth());
    const fail = findings[0];
    expect(fail.suggestions).toContain('Set PERCY_TOKEN in your environment: export PERCY_TOKEN=<your-token>');
    expect(fail.suggestions).toContain('In CI, add PERCY_TOKEN as a secret environment variable.');
  });

  it('includes suggestions for 401 auth failure', async () => {
    const findings = await checkAuthWithMock('invalid_token');
    const authFail = findings.find(f => f.code === 'PERCY-DR-004');
    expect(authFail.suggestions.some(s => s.includes('expired'))).toBe(true);
    expect(authFail.suggestions.some(s => s.includes('Project Settings'))).toBe(true);
  });
});
