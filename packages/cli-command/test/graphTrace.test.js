import { renderGraphTraceHtml } from '../src/graphTrace.js';

// The trace template embeds each payload as `const <name> = <json>;` on its
// own line (see graphTraceTemplate.html). Pulling that line back out lets us
// assert both the computed layout and the escaping that renderGraphTraceHtml
// applies, without exporting the module-private helpers it delegates to.
function embeddedJson(html, name) {
  // test-only helper; name is a hardcoded literal ('vertices'/'edges') from the test, not external input (reviewed, approved by security)
  let match = html.match(new RegExp(`const ${name} = (.*);`)); // nosemgrep
  if (!match) throw new Error(`could not find embedded "${name}" payload`);
  return match[1];
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
      // a(dependency) -> b(component) -> c(component), no closure hints, so the
      // edge constraint alone drives the columns: 0, 1, 2.
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
      // Two same-column components must not collide on row 0.
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
      // Two same-kind vertices with identical names land in the same column
      // group and hit the comparator's final equal-name branch (returns 0).
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
      // All three dependencies are pinned to column 0, but the changed one ranks
      // as is_relevant (1) vs package (0) for the others — mixed ranks in one
      // column exercise the rank-differs branch, and the two packages exercise
      // the name tie-break.
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
      // packages (rank 0) sort by name first, then the changed/is_relevant one.
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
          [0, 0, 5], // u === v → skipped
          [0, 1, 0], // val <= 0 → skipped
          [0, 2, 3], // sets incomingMax[2] = 3
          [1, 2, 2] // 2 is not > 3 → incomingMax[2] left unchanged
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
      // Cyclic edges would loop forever without the bounded iteration guard;
      // out-of-range edge/closure indices must be ignored, not throw.
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
    // Build a name carrying every sequence safeJson must neutralize so a
    // malicious file_path can't break out of the surrounding <script> block.
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
      // The output is embedded in a <script> block (JS), where `<\!--` reads as
      // the literal `<!--`. Reverting just safeJson's extra escapes must yield
      // parseable JSON that round-trips to the original hostile name — i.e. no
      // structural characters were collateral-damaged.
      let restored = hostileLine()
        .split('<\\!--').join('<!--')
        .split('--\\>').join('-->');
      expect(JSON.parse(restored)[0].name).toEqual(hostile);
    });
  });
});
