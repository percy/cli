// Secret-pattern redaction with a fast-reject prefix filter. See DPR-6 and
// DPR-7 in docs/plans/2026-04-23-001-feat-disk-backed-hybrid-log-store-plan.md.
//
// - Patterns load once at module import.
// - Each pattern's literal markers (>= 4 chars) are extracted.
// - Patterns with at least one marker land in ANCHORED; patterns with no
//   marker (pure-entropy) land in ALWAYS_RUN.
// - A single unioned regex MARKER_UNION is built from every distinct marker
//   across all patterns. redactString runs this first — if it doesn't match,
//   the line has no anchored patterns and we can skip the anchored set
//   entirely (O(|str|) single scan vs O(N*|str|) per-pattern).
// - Entropy patterns always run (~tens of regexes; acceptable cost).
//
// Never throws — a broken pattern must not silence logs. Failures fall open.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

import { extractLiteralMarkers, escapeForRegex } from './redact/extract-markers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load + pre-compile once. Any pattern that fails to compile is skipped with
// a console.warn rather than crashing module import.
const rawPatterns = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'secret-patterns.json'), 'utf8')).patterns;
  } catch (err) {
    /* istanbul ignore next */
    return [];
  }
})();

const ANCHORED = [];
const alwaysRunSources = [];
const markerToPatterns = new Map(); // marker -> Set<pattern index in ANCHORED>

for (const p of rawPatterns) {
  let re;
  try { re = new RegExp(p.pattern.regex, 'g'); } catch (_) { continue; }
  const markers = extractLiteralMarkers(p.pattern.regex);
  if (markers.length === 0) {
    alwaysRunSources.push(p.pattern.regex);
  } else {
    const idx = ANCHORED.push({ re, markers }) - 1;
    for (const m of markers) {
      let set = markerToPatterns.get(m);
      if (!set) { set = new Set(); markerToPatterns.set(m, set); }
      set.add(idx);
    }
  }
}

// Batch the always-run (pure-entropy) patterns into a single unioned regex.
// V8 optimises N-way top-level alternation into a trie-based single pass,
// cutting clean-line cost from ~O(N*|str|) to ~O(|str|). Wrap each source in
// a non-capturing group so internal alternations don't leak across.
const ALWAYS_RUN_UNION = alwaysRunSources.length > 0
  ? new RegExp(alwaysRunSources.map(src => `(?:${src})`).join('|'), 'g')
  : null;

// Unioned marker regex — sorted by length desc so V8's matcher prefers the
// most specific (longest) match at each position. Uses /g so we can
// iterate every marker hit in the string in one pass.
const MARKER_UNION = markerToPatterns.size > 0
  ? new RegExp([...markerToPatterns.keys()].sort((a, b) => b.length - a.length).map(escapeForRegex).join('|'), 'g')
  : null;

// Exposed for tests (DPR-21 supply-chain assertion).
export const PATTERNS_COUNT = rawPatterns.length;
export const MARKER_COUNT = markerToPatterns.size;

// Redact secrets in a single string. Fail-open on any internal error.
export function redactString (str) {
  if (typeof str !== 'string' || str.length === 0) return str;
  let out = str;

  try {
    // (1) Always-run entropy patterns — run as one unioned regex for V8 trie.
    if (ALWAYS_RUN_UNION) out = out.replace(ALWAYS_RUN_UNION, '[REDACTED]');

    // (2) Per-marker pattern gate: single V8 regex scan finds every marker
    //     that appears in the line; run only the patterns indexed under
    //     those markers (typically 0-3 patterns per clean line, instead of
    //     all ~1,600). This is what makes the clean-line budget work when
    //     the pattern set includes common-word anchors like "build" or
    //     "checkout" that real log lines frequently contain.
    if (MARKER_UNION) {
      MARKER_UNION.lastIndex = 0;
      const toRun = new Set();
      let m;
      while ((m = MARKER_UNION.exec(out)) !== null) {
        const patternIndexes = markerToPatterns.get(m[0]);
        if (patternIndexes) for (const idx of patternIndexes) toRun.add(idx);
        if (m[0].length === 0) MARKER_UNION.lastIndex++; // avoid zero-width loop
      }
      for (const idx of toRun) out = out.replace(ANCHORED[idx].re, '[REDACTED]');
    }
  } catch (_) {
    /* istanbul ignore next */
    return str;
  }
  return out;
}

// Back-compat public API — was previously exported from @percy/core/utils.
// Preserved exact semantics for any external consumer that imported it.
export function redactSecrets (data) {
  if (Array.isArray(data)) return data.map(redactSecrets);
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string') data.message = redactString(data.message);
    return data;
  }
  if (typeof data === 'string') return redactString(data);
  return data;
}
