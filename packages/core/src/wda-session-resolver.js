// Reader side of the realmobile ↔ Percy CLI wda-meta.json contract (v1.x).
// See: percy-maestro/docs/contracts/realmobile-wda-meta.md
//
// Resolves a Maestro sessionId to its WDA port (and optionally WDA's internal
// session UUID as of v1.1.0) by reading
//   /tmp/<sid>/wda-meta.json
// and validating per contract §8. TOCTOU-safe (SEI CERT POS35-C ordering:
// open(O_NOFOLLOW) + fstat — never lstat prefix).
//
// All failure paths return a scrubbed reason tag; no file contents, raw
// sessionIds, port numbers, or paths are emitted to logs (contract §5).

import fs from 'fs';
import path from 'path';
import { constants as fsConstants } from 'fs';
import loggerFactory from '@percy/logger';

const log = loggerFactory('core:wda-session');

const WDA_PORT_MIN = 8400;
const WDA_PORT_MAX = 8410;
const FRESHNESS_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_ID_REGEX = /^[A-Za-z0-9_-]{16,64}$/;
// WDA's internal session id is a UUID (hex + hyphens). Keep the bounds generous
// so we tolerate format variations across WDA versions.
const WDA_SESSION_ID_REGEX = /^[A-Fa-f0-9-]{16,64}$/;
const REGULAR_FILE_MODE_0600 = 0o100600;

// Resolves /tmp/<sessionId>/wda-meta.json → { ok: true, port, wdaSessionId? }
// or { ok: false, reason }.
//
// wdaSessionId is populated only when the meta file's schema is v1.1.0+ and
// includes a well-formed WDA UUID; otherwise it is omitted and callers fall
// back to SDK sessionId (which v1.0.0 writers cannot distinguish from WDA's
// internal session).
//
// Params:
//   sessionId — the Maestro session id from the relay request
//   baseDir — parent directory (default /tmp; overridable for tests)
//   deps — { getuid, getStartupTimestamp } for testability
//
// Reason tags (enum):
//   invalid-session-id, missing, symlink, wrong-mode, wrong-owner,
//   not-regular-file, multi-link, malformed-json, schema-version-unsupported,
//   out-of-range-port, session-mismatch, stale-timestamp, read-error
export function resolveWdaSession({ sessionId, baseDir = '/tmp', deps = {} } = {}) {
  const getuid = deps.getuid || (() => process.getuid());
  const getStartupTimestamp = deps.getStartupTimestamp || (() => Date.now());

  if (!isValidSessionId(sessionId)) {
    log.debug('wda-session: invalid-session-id');
    return { ok: false, reason: 'invalid-session-id' };
  }

  const filePath = path.join(baseDir, sessionId, 'wda-meta.json');

  // Step 1: open(O_NOFOLLOW | O_RDONLY | O_NONBLOCK) — atomic symlink refusal.
  //   ELOOP → symlink
  //   ENOENT → missing
  let fd;
  try {
    const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
    fd = fs.openSync(filePath, flags);
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      log.debug('wda-session: symlink');
      return { ok: false, reason: 'symlink' };
    }
    if (err && err.code === 'ENOENT') {
      log.debug('wda-session: missing');
      return { ok: false, reason: 'missing' };
    }
    log.debug('wda-session: read-error');
    return { ok: false, reason: 'read-error' };
  }

  try {
    // Step 2: fstat on the opened fd — authoritative mode+ownership+nlink check.
    const st = fs.fstatSync(fd);

    if (!st.isFile()) {
      log.debug('wda-session: not-regular-file');
      return { ok: false, reason: 'not-regular-file' };
    }
    if ((st.mode & 0o170777) !== REGULAR_FILE_MODE_0600) {
      // 0o170777 = file-type + perms bits; exact match against 0100600
      // (S_IFREG | 0600)
      log.debug('wda-session: wrong-mode');
      return { ok: false, reason: 'wrong-mode' };
    }
    if (st.uid !== getuid()) {
      log.debug('wda-session: wrong-owner');
      return { ok: false, reason: 'wrong-owner' };
    }
    if (st.nlink !== 1) {
      // Hardlink-attack defense (Apple Secure Coding Guide — CVE-2005-2519 class)
      log.debug('wda-session: multi-link');
      return { ok: false, reason: 'multi-link' };
    }

    // Step 3: read content from the already-opened fd.
    const raw = fs.readFileSync(fd, 'utf8');

    // Step 4: JSON parse.
    let meta;
    try {
      meta = JSON.parse(raw);
    } catch {
      log.debug('wda-session: malformed-json');
      return { ok: false, reason: 'malformed-json' };
    }

    // Step 5: schema validate required fields.
    if (typeof meta !== 'object' || meta === null) {
      log.debug('wda-session: malformed-json');
      return { ok: false, reason: 'malformed-json' };
    }
    if (typeof meta.schema_version !== 'string' || !isSupportedSchemaVersion(meta.schema_version)) {
      // Distinguish malformed (not a string, or not semver-major === 1)
      if (typeof meta.schema_version !== 'string') {
        log.debug('wda-session: malformed-json');
        return { ok: false, reason: 'malformed-json' };
      }
      log.debug('wda-session: schema-version-unsupported');
      return { ok: false, reason: 'schema-version-unsupported' };
    }
    if (!Number.isInteger(meta.wdaPort) ||
        meta.wdaPort < WDA_PORT_MIN || meta.wdaPort > WDA_PORT_MAX) {
      log.debug('wda-session: out-of-range-port');
      return { ok: false, reason: 'out-of-range-port' };
    }
    if (typeof meta.sessionId !== 'string' || meta.sessionId !== sessionId) {
      log.debug('wda-session: session-mismatch');
      return { ok: false, reason: 'session-mismatch' };
    }
    if (!Number.isInteger(meta.flowStartTimestamp)) {
      log.debug('wda-session: malformed-json');
      return { ok: false, reason: 'malformed-json' };
    }

    // Step 6: freshness (JSON-internal timestamp; fs mtime is untrusted).
    const startupTs = getStartupTimestamp();
    if (meta.flowStartTimestamp < startupTs - FRESHNESS_TOLERANCE_MS) {
      log.debug('wda-session: stale-timestamp');
      return { ok: false, reason: 'stale-timestamp' };
    }

    // Step 7: v1.1.0+ optional wdaSessionId. Ignore silently if malformed —
    // callers treat absence the same as presence of an invalid value.
    const result = { ok: true, port: meta.wdaPort };
    if (typeof meta.wdaSessionId === 'string' && WDA_SESSION_ID_REGEX.test(meta.wdaSessionId)) {
      result.wdaSessionId = meta.wdaSessionId;
    }
    return result;
  } catch (err) {
    log.debug('wda-session: read-error');
    return { ok: false, reason: 'read-error' };
  } finally {
    try { fs.closeSync(fd); } catch { /* fd may already be closed on error path */ }
  }
}

function isValidSessionId(sid) {
  return typeof sid === 'string' &&
         !sid.includes('\0') &&
         !sid.includes('/') &&
         SESSION_ID_REGEX.test(sid);
}

function isSupportedSchemaVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return false;
  return parseInt(m[1], 10) === 1;
}
