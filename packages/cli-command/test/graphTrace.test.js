import { renderGraphTraceHtml } from '../src/graphTrace.js';

// The template declares each payload on its own line as `const <name> = <json>;`.
// Extracted by string search rather than a built RegExp: the pattern would be
// assembled from `name` at runtime, which trips semgrep's detect-non-literal-regexp
// (and inline `// nosemgrep` is not honored by the CI semgrep version).
function embeddedJson(html, name) {
  const prefix = `const ${name} = `;
  const start = html.indexOf(prefix);
  if (start === -1) throw new Error(`could not find embedded "${name}" payload`);

  const from = start + prefix.length;
  const lineEnd = html.indexOf('\n', from);
  const line = lineEnd === -1 ? html.slice(from) : html.slice(from, lineEnd);

  // last `;` on the line, matching the greedy `(.*);` this replaced
  const end = line.lastIndexOf(';');
  if (end === -1) throw new Error(`could not find embedded "${name}" payload`);
  return line.slice(0, end);
}

function vertices(html) {
  return JSON.parse(embeddedJson(html, 'vertices'));
}

describe('graphTrace', () => {
  describe('renderGraphTraceHtml() layout', () => {
    it('pins dependencies to column 0 and maps their kind to "package"', () => {
      let [dep] = vertices(renderGraphTraceHtml({
        vertices: [{ kind: 'dependency', file_path: 'left-pad' }],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      expect(dep.col).toEqual(0);
      expect(dep.kind).toEqual('package');
    });

    it('propagates columns along edges so a target sits right of its source', () => {
      let laidOut = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'dependency', file_path: 'pkg-a' },
          { kind: 'component', file_path: 'B.jsx' },
          { kind: 'component', file_path: 'C.jsx' }
        ],
        edges: [[0, 1], [1, 2]],
        transitiveClosureMatrixSparse: []
      }));

      expect(laidOut.map(v => v.col)).toEqual([0, 1, 2]);
    });

    it('pushes every story past the rightmost non-story column', () => {
      let laidOut = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'dependency', file_path: 'dep' },
          { kind: 'component', file_path: 'Comp.jsx' },
          { kind: 'story', file_path: 'A.stories.jsx' },
          { kind: 'story', file_path: 'B.stories.jsx' }
        ],
        edges: [[0, 1], [1, 2], [1, 3]],
        transitiveClosureMatrixSparse: [[0, 1, 1], [1, 2, 1], [1, 3, 1]]
      }));

      let maxNonStory = Math.max(...laidOut
        .filter(v => v.kind !== 'story')
        .map(v => v.col));

      for (let v of laidOut.filter(v => v.kind === 'story')) {
        expect(v.col).toBeGreaterThan(maxNonStory);
      }
    });

    it('lets `changed` win over the underlying kind ("is_relevant")', () => {
      let [comp, story] = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'component', file_path: 'Comp.jsx', changed: true },
          { kind: 'story', file_path: 'S.stories.jsx', changed: true }
        ],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      expect(comp.kind).toEqual('is_relevant');
      expect(story.kind).toEqual('is_relevant');
    });

    it('maps an unknown kind to "component"', () => {
      let [v] = vertices(renderGraphTraceHtml({
        vertices: [{ kind: 'mystery', file_path: 'x' }],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      expect(v.kind).toEqual('component');
    });

    it('preserves each vertex index and name', () => {
      let laidOut = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'component', file_path: 'first.jsx' },
          { kind: 'component', file_path: 'second.jsx' }
        ],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      expect(laidOut.map(v => v.index)).toEqual([0, 1]);
      expect(laidOut.map(v => v.name)).toEqual(['first.jsx', 'second.jsx']);
    });

    it('assigns unique rows within a shared column', () => {
      let laidOut = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'component', file_path: 'A.jsx' },
          { kind: 'component', file_path: 'B.jsx' }
        ],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      let col0 = laidOut.filter(v => v.col === laidOut[0].col);
      expect(col0.map(v => v.row).sort()).toEqual([0, 1]);
    });

    it('keeps a stable order for vertices that tie on rank and name', () => {
      let laidOut = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'component', file_path: 'Dup.jsx' },
          { kind: 'component', file_path: 'Dup.jsx' }
        ],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      expect(laidOut.map(v => v.name)).toEqual(['Dup.jsx', 'Dup.jsx']);
      expect(laidOut.map(v => v.row).sort()).toEqual([0, 1]);
    });

    it('orders a shared column by kind-rank then name', () => {
      let laidOut = vertices(renderGraphTraceHtml({
        vertices: [
          { kind: 'dependency', file_path: 'z-pkg' },
          { kind: 'dependency', file_path: 'a-pkg', changed: true },
          { kind: 'dependency', file_path: 'm-pkg' }
        ],
        edges: [],
        transitiveClosureMatrixSparse: []
      }));

      let col0 = laidOut.filter(v => v.col === 0).sort((a, b) => a.row - b.row);

      expect(col0.map(v => v.name)).toEqual(['m-pkg', 'z-pkg', 'a-pkg']);
    });

    it('skips self-loop, non-positive and lower-value closure triples', () => {
      let render = () => renderGraphTraceHtml({
        vertices: [
          { kind: 'component', file_path: 'A.jsx' },
          { kind: 'component', file_path: 'B.jsx' },
          { kind: 'component', file_path: 'C.jsx' }
        ],
        edges: [],
        transitiveClosureMatrixSparse: [
          [0, 0, 5],
          [0, 1, 0],
          [0, 2, 3],
          [1, 2, 2]
        ]
      });

      expect(render).not.toThrow();
      expect(vertices(render()).length).toEqual(3);
    });

    it('renders empty payloads without throwing', () => {
      let html = renderGraphTraceHtml({});
      expect(embeddedJson(html, 'vertices')).toEqual('[]');
      expect(embeddedJson(html, 'edges')).toEqual('[]');
      expect(embeddedJson(html, 'transitive_closure_matrix_sparse')).toEqual('[]');
    });

    it('tolerates cyclic edges and out-of-range indices', () => {
      let render = () => renderGraphTraceHtml({
        vertices: [
          { kind: 'component', file_path: 'x' },
          { kind: 'component', file_path: 'y' }
        ],
        edges: [[0, 1], [1, 0], [5, 9]],
        transitiveClosureMatrixSparse: [[0, 99, 3]]
      });

      expect(render).not.toThrow();
      expect(vertices(render()).length).toEqual(2);
    });
  });

  describe('renderGraphTraceHtml() escaping', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const hostile = `</script><!--${LS}${PS}-->`;

    function hostileLine() {
      return embeddedJson(renderGraphTraceHtml({
        vertices: [{ kind: 'component', file_path: hostile }],
        edges: [],
        transitiveClosureMatrixSparse: []
      }), 'vertices');
    }

    it('escapes "</" so it cannot close the script tag', () => {
      let line = hostileLine();
      expect(line).not.toContain('</script>');
      expect(line).toContain('<\\/script>');
    });

    it('escapes HTML comment open and close markers', () => {
      let line = hostileLine();
      expect(line).toContain('<\\!--');
      expect(line).toContain('--\\>');
    });

    it('escapes U+2028 and U+2029 line/paragraph separators', () => {
      let line = hostileLine();
      expect(line).not.toContain(LS);
      expect(line).not.toContain(PS);
      expect(line).toContain('\\u2028');
      expect(line).toContain('\\u2029');
    });

    it('escapes only the dangerous sequences, leaving the payload intact', () => {
      let restored = hostileLine()
        .split('<\\!--').join('<!--')
        .split('--\\>').join('-->');
      expect(JSON.parse(restored)[0].name).toEqual(hostile);
    });
  });
});
