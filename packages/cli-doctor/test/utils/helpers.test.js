/**
 * Tests for packages/cli-doctor/src/utils/helpers.js
 *
 * Tests cover the pure / side-effect-free exports:
 *   - redactProxyUrl
 *   - captureProxyEnv
 *   - PERCY_DOMAINS
 *
 * The section-runner functions (runConnectivityAndSSL, runProxyCheck, etc.) and
 * runDiagnostics delegate to the individual check modules that have their own
 * test suites; those are tested via light smoke tests using stub ctx objects.
 */

import {
  redactProxyUrl,
  captureProxyEnv,
  PERCY_DOMAINS
} from '../../src/utils/helpers.js';

import { withEnv } from '../helpers.js';

// ─── PERCY_DOMAINS ────────────────────────────────────────────────────────────

describe('PERCY_DOMAINS', () => {
  it('is a Set', () => {
    expect(PERCY_DOMAINS instanceof Set).toBe(true);
  });

  it('contains percy.io', () => {
    expect(PERCY_DOMAINS.has('percy.io')).toBe(true);
  });

  it('contains www.browserstack.com', () => {
    expect(PERCY_DOMAINS.has('www.browserstack.com')).toBe(true);
  });

  it('contains hub.browserstack.com', () => {
    expect(PERCY_DOMAINS.has('hub.browserstack.com')).toBe(true);
  });

  it('does not contain non-Percy domains', () => {
    expect(PERCY_DOMAINS.has('google.com')).toBe(false);
    expect(PERCY_DOMAINS.has('example.com')).toBe(false);
  });
});

// ─── redactProxyUrl ───────────────────────────────────────────────────────────

describe('redactProxyUrl', () => {
  it('returns the URL unchanged when there are no credentials', () => {
    expect(redactProxyUrl('http://proxy.corp.com:8080')).toBe('http://proxy.corp.com:8080/');
  });

  it('redacts username and password with ***', () => {
    const out = redactProxyUrl('http://alice:secret@proxy.corp.com:8080');
    expect(out).toContain('***:***');
    expect(out).not.toContain('alice');
    expect(out).not.toContain('secret');
  });

  it('redacts only the username when no password is present', () => {
    const out = redactProxyUrl('http://alice@proxy.corp.com:8080');
    expect(out).toContain('***');
    expect(out).not.toContain('alice');
  });

  it('preserves the host and port after redaction', () => {
    const out = redactProxyUrl('http://u:p@myproxy.corp.com:3128');
    expect(out).toContain('myproxy.corp.com');
    expect(out).toContain('3128');
  });

  it('preserves the path after redaction', () => {
    const out = redactProxyUrl('http://u:p@proxy.corp.com:8080/path');
    expect(out).toContain('/path');
  });

  it('returns null as-is', () => {
    expect(redactProxyUrl(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(redactProxyUrl(undefined)).toBeUndefined();
  });

  it('returns empty string as-is', () => {
    expect(redactProxyUrl('')).toBe('');
  });

  it('returns the original value when the string is not a valid URL', () => {
    expect(redactProxyUrl('not-a-url')).toBe('not-a-url');
  });

  it('handles HTTPS proxy URLs', () => {
    const out = redactProxyUrl('https://admin:pass@secure-proxy.corp.com:443');
    expect(out).toContain('***:***');
    expect(out).toContain('secure-proxy.corp.com');
  });

  it('handles SOCKS proxy URLs', () => {
    const out = redactProxyUrl('socks5://user:pw@socks.proxy.com:1080');
    expect(out).toContain('***:***');
    expect(out).not.toContain('user');
    expect(out).not.toContain('pw');
  });
});

// ─── captureProxyEnv ──────────────────────────────────────────────────────────

describe('captureProxyEnv', () => {
  it('returns an empty object when no proxy env vars are set', async () => {
    const result = await withEnv({
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
      HTTP_PROXY: undefined,
      http_proxy: undefined,
      ALL_PROXY: undefined,
      all_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
      NODE_TLS_REJECT_UNAUTHORIZED: undefined,
      NODE_EXTRA_CA_CERTS: undefined,
      PERCY_BROWSER_EXECUTABLE: undefined
    }, () => captureProxyEnv());
    expect(Object.keys(result).length).toBe(0);
  });

  it('captures HTTPS_PROXY', async () => {
    const result = await withEnv({ HTTPS_PROXY: 'http://proxy:8080' }, () => captureProxyEnv());
    expect(result.HTTPS_PROXY).toBe('http://proxy:8080/');
  });

  it('captures lowercase https_proxy', async () => {
    const result = await withEnv({ https_proxy: 'http://proxy:8080' }, () => captureProxyEnv());
    expect(result.https_proxy).toBe('http://proxy:8080/');
  });

  it('captures HTTP_PROXY', async () => {
    const result = await withEnv({ HTTP_PROXY: 'http://proxy:3128' }, () => captureProxyEnv());
    expect(result.HTTP_PROXY).toBe('http://proxy:3128/');
  });

  it('captures ALL_PROXY', async () => {
    const result = await withEnv({ ALL_PROXY: 'http://proxy:8888' }, () => captureProxyEnv());
    expect(result.ALL_PROXY).toBe('http://proxy:8888/');
  });

  it('redacts credentials in proxy URL values', async () => {
    const result = await withEnv(
      { HTTPS_PROXY: 'http://user:secret@proxy.corp:8080' },
      () => captureProxyEnv()
    );
    expect(result.HTTPS_PROXY).toContain('***:***');
    expect(result.HTTPS_PROXY).not.toContain('secret');
  });

  it('captures NO_PROXY without redaction', async () => {
    const result = await withEnv({ NO_PROXY: 'localhost,127.0.0.1' }, () => captureProxyEnv());
    expect(result.NO_PROXY).toBe('localhost,127.0.0.1');
  });

  it('captures NODE_TLS_REJECT_UNAUTHORIZED without redaction', async () => {
    const result = await withEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, () => captureProxyEnv());
    expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
  });

  it('captures NODE_EXTRA_CA_CERTS without redaction', async () => {
    const result = await withEnv(
      { NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca.pem' },
      () => captureProxyEnv()
    );
    expect(result.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/certs/ca.pem');
  });

  it('captures PERCY_BROWSER_EXECUTABLE without redaction', async () => {
    const result = await withEnv(
      { PERCY_BROWSER_EXECUTABLE: '/usr/bin/google-chrome' },
      () => captureProxyEnv()
    );
    expect(result.PERCY_BROWSER_EXECUTABLE).toBe('/usr/bin/google-chrome');
  });

  it('does not include keys that are not set', async () => {
    const result = await withEnv({
      HTTPS_PROXY: 'http://proxy:8080',
      HTTP_PROXY: undefined,
      ALL_PROXY: undefined,
      https_proxy: undefined,
      http_proxy: undefined,
      all_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
      NODE_TLS_REJECT_UNAUTHORIZED: undefined,
      NODE_EXTRA_CA_CERTS: undefined,
      PERCY_BROWSER_EXECUTABLE: undefined
    }, () => captureProxyEnv());
    expect(Object.keys(result)).toEqual(['HTTPS_PROXY']);
  });

  it('captures multiple proxy vars simultaneously', async () => {
    const result = await withEnv({
      HTTPS_PROXY: 'http://https-proxy:8080',
      HTTP_PROXY: 'http://http-proxy:3128',
      NO_PROXY: 'localhost'
    }, () => captureProxyEnv());
    expect(result.HTTPS_PROXY).toBeTruthy();
    expect(result.HTTP_PROXY).toBeTruthy();
    expect(result.NO_PROXY).toBe('localhost');
  });
});
