import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_MARKER_LEN = 3;

// Common English + URL/keyword noise that would appear in nearly every log
// line and defeat the fast-reject index. Kept intentionally small.
const NOISE_WORDS = new Set([
  'the', 'and', 'for', 'are', 'not', 'was', 'but', 'can', 'get', 'set',
  'log', 'out', 'you', 'his', 'her', 'one', 'two', 'all', 'any', 'new',
  'now', 'has', 'had', 'yes', 'off', 'use', 'how', 'why', 'who', 'our',
  'http', 'https', 'www', 'true', 'false', 'null', 'name', 'type', 'path',
  'time', 'date', 'info', 'user', 'pass', 'token', 'com', 'net', 'org'
]);

// Single-pass walker over a regex source. Collects every literal run of
// length >= MIN_MARKER_LEN that MUST appear in any string matching the regex.
// Returns [] for pure-entropy patterns (e.g. /\b[a-f0-9]{32}\b/).
export function extractLiteralMarkers(src) {
  const markers = [];
  let run = '';
  let i = 0;
  let classDepth = 0;
  let lastCharLiteral = false;

  const push = () => {
    if (run.length >= MIN_MARKER_LEN && !NOISE_WORDS.has(run.toLowerCase())) {
      markers.push(run);
    }
    run = '';
    lastCharLiteral = false;
  };

  while (i < src.length) {
    const c = src[i];

    if (classDepth > 0) {
      if (c === '\\') { i += 2; continue; }
      if (c === ']') classDepth = 0;
      i++;
      continue;
    }
    if (c === '[') { push(); classDepth = 1; i++; continue; }

    if (c === '\\') {
      const n = src[i + 1];
      if (n && /[.\-_/@:]/.test(n)) {
        run += n;
        lastCharLiteral = true;
      } else {
        push();
      }
      i += 2;
      continue;
    }

    if (c === '(' || c === ')' || c === '|') {
      push();
      if (c === '(' && src[i + 1] === '?') {
        i += 2;
        if (src[i] === ':' || src[i] === '=' || src[i] === '!') { i++; continue; }
        if (src[i] === '<' || src[i] === 'P') {
          while (i < src.length && src[i] !== '>') i++;
          if (src[i] === '>') i++;
        }
        continue;
      }
      i++;
      continue;
    }

    // A quantified final char is optional, so it cannot anchor the run.
    if (c === '?' || c === '*' || c === '+' || c === '{') {
      if (lastCharLiteral && run.length > 0) run = run.slice(0, -1);
      push();
      if (c === '{') {
        while (i < src.length && src[i] !== '}') i++;
      }
      i++;
      continue;
    }

    if (c === '^' || c === '$') { push(); i++; continue; }

    if (/[a-zA-Z0-9_-]/.test(c)) {
      run += c;
      lastCharLiteral = true;
      i++;
      continue;
    }

    push();
    i++;
  }
  push();
  return [...new Set(markers)];
}

export function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a redactor from a raw pattern list. Exposed so tests can exercise
// the empty / partial pattern-set branches that the module-level defaults
// cannot reach once the full secret-patterns.json has loaded.
export function createRedactor(rawPatterns) {
  const anchored = [];
  const alwaysRunSources = [];
  const markerToPatterns = new Map();

  for (const p of rawPatterns) {
    let re;
    try { re = new RegExp(p.pattern.regex, 'g'); } catch (_) { continue; }
    const markers = extractLiteralMarkers(p.pattern.regex);
    if (markers.length === 0) {
      alwaysRunSources.push(p.pattern.regex);
    } else {
      const idx = anchored.push({ re, markers }) - 1;
      for (const m of markers) {
        let set = markerToPatterns.get(m);
        if (!set) { set = new Set(); markerToPatterns.set(m, set); }
        set.add(idx);
      }
    }
  }

  // V8 optimises N-way top-level alternation into a trie-based single pass,
  // turning O(N * |str|) into ~O(|str|) for the clean-line case.
  const alwaysRunUnion = alwaysRunSources.length > 0
    ? new RegExp(alwaysRunSources.map(src => `(?:${src})`).join('|'), 'g')
    : null;

  // Longest marker first so the matcher prefers the most specific match.
  const markerUnion = markerToPatterns.size > 0
    ? new RegExp([...markerToPatterns.keys()].sort((a, b) => b.length - a.length).map(escapeForRegex).join('|'), 'g')
    : null;

  // Fail-open on any internal error — the logger must never be silenced by
  // a redact bug.
  function redactString(str) {
    if (typeof str !== 'string' || str.length === 0) return str;
    let out = str;

    try {
      if (alwaysRunUnion) out = out.replace(alwaysRunUnion, '[REDACTED]');

      if (markerUnion) {
        markerUnion.lastIndex = 0;
        const toRun = new Set();
        let m;
        while ((m = markerUnion.exec(out)) !== null) {
          const patternIndexes = markerToPatterns.get(m[0]);
          if (patternIndexes) for (const idx of patternIndexes) toRun.add(idx);
          if (m[0].length === 0) markerUnion.lastIndex++;
        }
        for (const idx of toRun) out = out.replace(anchored[idx].re, '[REDACTED]');
      }
    } catch (_) {
      /* istanbul ignore next */
      return str;
    }
    return out;
  }

  function redactSecrets(data) {
    if (Array.isArray(data)) return data.map(redactSecrets);
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string') data.message = redactString(data.message);
      return data;
    }
    if (typeof data === 'string') return redactString(data);
    return data;
  }

  return {
    redactString,
    redactSecrets,
    patternsCount: rawPatterns.length,
    markerCount: markerToPatterns.size
  };
}

const rawPatterns = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'secret-patterns.json'), 'utf8')).patterns;
  } catch (err) {
    /* istanbul ignore next */
    return [];
  }
})();

const defaultRedactor = createRedactor(rawPatterns);

export const redactString = defaultRedactor.redactString;
export const redactSecrets = defaultRedactor.redactSecrets;
export const PATTERNS_COUNT = defaultRedactor.patternsCount;
export const MARKER_COUNT = defaultRedactor.markerCount;
