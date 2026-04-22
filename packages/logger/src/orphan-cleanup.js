// Best-effort orphan sweep for abandoned spill directories. See DPR-9, DPR-17.
//
// Invoked once per process at logger init; must never throw out to the caller
// and must never block startup for more than a fraction of a second. Each
// qualifying directory is rm'd with retries (Windows AV / EBUSY resilience).
//
// Skip criteria:
//  - prefix must match DIR_PREFIX
//  - mtime must be older than TTL_MS (24 h)
//  - on POSIX, uid must match process.getuid()
//  - directory whose `pid` file names a currently-live process is skipped
//    regardless of mtime (clock-skew safety)

import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

export const DIR_PREFIX = 'percy-logs-';
const TTL_MS = 24 * 60 * 60 * 1000;
const IS_WINDOWS = process.platform === 'win32';

let swept = false; // module-level guard — sweep runs at most once per process

export async function sweepOrphans (tmpdir = os.tmpdir(), now = Date.now()) {
  if (swept) return { removed: 0, bytes: 0, skipped: true };
  swept = true;

  let removed = 0;
  let bytes = 0;
  let entries;
  try { entries = await fsp.readdir(tmpdir, { withFileTypes: true }); }
  catch (_) { return { removed: 0, bytes: 0 }; }

  const myUid = !IS_WINDOWS && typeof process.getuid === 'function'
    ? process.getuid()
    : null;

  for (const de of entries) {
    if (!de.isDirectory() || !de.name.startsWith(DIR_PREFIX)) continue;
    const full = path.join(tmpdir, de.name);
    try {
      const st = await fsp.stat(full);

      // uid check (POSIX only)
      if (myUid !== null && st.uid !== myUid) continue;

      // PID-alive check — if the dir has a live owner, skip regardless of mtime
      const live = await isPidAlive(full);
      if (live) continue;

      // mtime gate — only sweep dirs older than 24 h
      if (now - st.mtimeMs < TTL_MS) continue;

      const sz = await dirSize(full);
      await fsp.rm(full, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
      removed++;
      bytes += sz;
    } catch (_) { /* permission / race / vanished — ignore */ }
  }
  return { removed, bytes };
}

// Test-only hook: reset the module guard so tests can sweep multiple times.
export function __resetGuard () { swept = false; }

async function isPidAlive (dir) {
  try {
    const raw = await fsp.readFile(path.join(dir, 'pid'), 'utf8');
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      // signal 0 probes process existence without actually signalling.
      // Throws ESRCH if no such process, EPERM if alive but not ours.
      process.kill(pid, 0);
      return true;
    } catch (e) {
      if (e.code === 'EPERM') return true; // alive, owned by another uid
      return false;
    }
  } catch (_) {
    // No pid file (older version or write race) — treat as not-live so it
    // becomes eligible once mtime passes the TTL gate.
    return false;
  }
}

async function dirSize (p) {
  let total = 0;
  try {
    for (const de of await fsp.readdir(p, { withFileTypes: true })) {
      const full = path.join(p, de.name);
      if (de.isDirectory()) total += await dirSize(full);
      else {
        try { const s = await fsp.stat(full); total += s.size; } catch (_) {}
      }
    }
  } catch (_) { /* permission or race — return partial size */ }
  return total;
}
