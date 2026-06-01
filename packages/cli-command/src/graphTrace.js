import fs from 'fs';
import path from 'path';
import url from 'url';

// Template resolution mirrors core/utils.js's secretPatterns.yml lookup:
// resolves relative to this file's URL so it works under src/ (dev) and
// dist/ (installed) without bundler help. The .html file is copied alongside
// by babel's copyFiles when cli-command is built.
const TEMPLATE_PATH = path.resolve(url.fileURLToPath(import.meta.url), '../graphTraceTemplate.html');

// Maps a (raw kind, changed) pair to the kind value the template expects:
// 'package' | 'component' | 'story' | 'is_relevant'. `changed: true` wins
// over the underlying kind so any node touched in the diff renders purple.
function templateKindOf(v) {
  if (v.changed) return 'is_relevant';
  switch (v.kind) {
    case 'dependency': return 'package';
    case 'component': return 'component';
    case 'story': return 'story';
    default: return 'component';
  }
}

// Sort order within a column: packages left, components middle, stories right.
// `is_relevant` shares rank with components so a changed node doesn't jump
// out of its own group — it just recolors.
const KIND_RANK = { package: 0, component: 1, is_relevant: 1, story: 2 };

// Layout algorithm (ported from the original Ruby renderer):
//   1. col = longest-path depth reaching the vertex (read from the
//      transitive-closure triples the API sends), with dependencies pinned
//      to col 0.
//   2. Propagate over edges so col[target] > col[source]. Bounded loop
//      guards against degenerate inputs.
//   3. Stories pushed past the rightmost non-story column.
//   4. Within each column, sort by (kind-rank, name) and assign row.
function computeLayout(rawVertices, edges, transitiveClosure) {
  const n = rawVertices.length;
  const vertices = rawVertices.map((v, i) => ({
    index: i,
    name: v.file_path,
    kind: v.kind,
    changed: !!v.changed,
    row: 0,
    col: 0
  }));

  // 1. Seed col from incoming transitive-closure lengths.
  const incomingMax = new Array(n).fill(0);
  for (const triple of transitiveClosure) {
    const [u, v, val] = triple;
    if (u === v || val <= 0) continue;
    if (v < 0 || v >= n) continue;
    if (val > incomingMax[v]) incomingMax[v] = val;
  }
  for (let i = 0; i < n; i++) {
    vertices[i].col = vertices[i].kind === 'dependency' ? 0 : incomingMax[i] + 1;
  }

  // 2. Propagate edge constraint. n+2 iterations is enough for any DAG
  // and bounds the work on accidentally-cyclic input.
  const iterations = n + 2;
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (const [s, t] of edges) {
      if (s < 0 || s >= n || t < 0 || t >= n) continue;
      if (vertices[s].col < vertices[t].col) continue;
      vertices[t].col = vertices[s].col + 1;
      changed = true;
    }
    if (!changed) break;
  }

  // 3. Stories rightmost. Two passes: max across non-stories first, then
  // push every story past that boundary. Folding into one loop would let
  // stories visited before the last non-story keep a stale max.
  let furthestNonStory = 0;
  for (const v of vertices) {
    if (v.kind === 'story') continue;
    if (v.col > furthestNonStory) furthestNonStory = v.col;
  }
  for (const v of vertices) {
    if (v.kind !== 'story') continue;
    if (v.col < furthestNonStory + 1) v.col = furthestNonStory + 1;
  }

  // 4. Group by column, sort by (kind-rank, name), assign row.
  const groups = new Map();
  for (const v of vertices) {
    let list = groups.get(v.col);
    if (!list) groups.set(v.col, list = []);
    list.push(v);
  }
  const rankOf = v => {
    const r = KIND_RANK[templateKindOf(v)];
    /* istanbul ignore next: templateKindOf always returns a kind present in
       KIND_RANK, so the `=== undefined` fallback is defensive */
    return r === undefined ? 99 : r;
  };
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      // Byte-wise compare on name to match Ruby's String#<=> behaviour.
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
    list.forEach((v, row) => { v.row = row; });
  }

  // 5. Final shape the template consumes: drop `changed`, fold it into kind.
  return vertices.map(v => ({
    index: v.index,
    name: v.name,
    row: v.row,
    col: v.col,
    kind: templateKindOf(v)
  }));
}

// Escapes characters that have meaning inside a <script> block so user-derived
// strings (e.g. a vertex file_path) can't break out of the surrounding tag.
// `</` covers `</script>`; `<!--`/`-->` cover HTML comment confusion; U+2028
// and U+2029 are valid JSON but illegal in JS string literals pre-ES2019 and
// have historically been XSS sinks.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--')
    .replace(/--(!?)>/g, '--$1\\>')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}

// Populates the trace template with the three JSON payloads the page needs.
// Input shape matches the API's graph data: `vertices` carries `kind`,
// `file_path`, `changed`; `edges` and `transitive_closure_matrix_sparse`
// are arrays of integer tuples.
export function renderGraphTraceHtml({ vertices, edges, transitiveClosureMatrixSparse }) {
  const laidOutVertices = computeLayout(
    vertices || [],
    edges || [],
    transitiveClosureMatrixSparse || []
  );
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return template
    .replace('__VERTICES_JSON__', safeJson(laidOutVertices))
    .replace('__EDGES_JSON__', safeJson(edges || []))
    .replace('__TRANSITIVE_CLOSURE_JSON__', safeJson(transitiveClosureMatrixSparse || []));
}
