// Extract literal string markers from a regex source so callers can build a
// fast-reject filter over the secret-patterns set. See DPR-7 in the plan:
// docs/plans/2026-04-23-001-feat-disk-backed-hybrid-log-store-plan.md
//
// A "marker" is a literal alphanumeric run (>= MIN_MARKER_LEN chars) that must
// appear in any string that could match the original regex. We collect every
// such run across the source, including branches of top-level alternations
// inside (), and return them as an array. Patterns with no extractable marker
// (pure entropy regexes like `\b[a-f0-9]{32}\b`) return an empty array and
// fall into the "always run" set at the caller.
//
// The extractor is a single-pass string walker — no regex engine dependency,
// zero runtime cost beyond module load.

const MIN_MARKER_LEN = 3;

// Exclude common substrings that would match almost every log line and defeat
// the fast-reject. Lowercased comparison. Kept deliberately small — too many
// exclusions hurt the fast-path by forcing more patterns into ALWAYS_RUN.
const NOISE_WORDS = new Set([
  // common English 3- and 4-letter words that would appear in most log lines
  'the', 'and', 'for', 'are', 'not', 'was', 'but', 'can', 'get', 'set',
  'log', 'out', 'you', 'his', 'her', 'one', 'two', 'all', 'any', 'new',
  'now', 'has', 'had', 'yes', 'off', 'use', 'how', 'why', 'who', 'our',
  'http', 'https', 'www', 'true', 'false', 'null', 'name', 'type', 'path',
  'time', 'date', 'info', 'user', 'pass', 'token', 'com', 'net', 'org'
]);

export function extractLiteralMarkers (src) {
  const markers = [];
  let run = '';
  let i = 0;
  let classDepth = 0;      // inside [...]
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

    // Character class [...] — opaque; contents are alternatives, no literal
    if (classDepth > 0) {
      if (c === '\\') { i += 2; continue; }
      if (c === ']') classDepth = 0;
      i++;
      continue;
    }
    if (c === '[') { push(); classDepth = 1; i++; continue; }

    // Escape
    if (c === '\\') {
      const n = src[i + 1];
      // Escaped punctuation we treat as literal continuation
      if (n && /[.\-_/@:]/.test(n)) {
        run += n;
        lastCharLiteral = true;
      } else {
        // \d \s \w \b \n \t etc. break any literal run
        push();
      }
      i += 2;
      continue;
    }

    // Group open / close / alternation — all break the run but allow
    // collection across (e.g. (foo|bar) yields ['foo','bar'] if >= MIN)
    if (c === '(' || c === ')' || c === '|') {
      push();
      // handle (?: (?= (?! and (?P<name>
      if (c === '(' && src[i + 1] === '?') {
        // advance past the (? prefix
        i += 2;
        if (src[i] === ':' || src[i] === '=' || src[i] === '!') { i++; continue; }
        // (?<name>, (?P<name>, (?P=name) etc. — skip to closing > or =
        if (src[i] === '<' || src[i] === 'P') {
          while (i < src.length && src[i] !== '>') i++;
          if (src[i] === '>') i++;
        }
        continue;
      }
      i++;
      continue;
    }

    // Quantifier ? * + {n,m} — the char just before was literal but optional,
    // so it cannot be relied on as a marker
    if (c === '?' || c === '*' || c === '+' || c === '{') {
      if (lastCharLiteral && run.length > 0) run = run.slice(0, -1);
      push();
      if (c === '{') {
        while (i < src.length && src[i] !== '}') i++;
      }
      i++;
      continue;
    }

    // Anchor ^ or $
    if (c === '^' || c === '$') { push(); i++; continue; }

    // Plain literal character we keep
    if (/[a-zA-Z0-9_-]/.test(c)) {
      run += c;
      lastCharLiteral = true;
      i++;
      continue;
    }

    // Anything else (unescaped `.`, whitespace, etc.) breaks the run
    push();
    i++;
  }
  push();

  // Deduplicate markers from this single source
  return [...new Set(markers)];
}

// Escape a string so it can be safely embedded as a literal inside a regex.
export function escapeForRegex (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
