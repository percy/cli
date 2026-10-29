import { getOuterHTML } from '../src/clone-dom';

describe('getOuterHTML', () => {
  // A detached <html> element standing in for a clone's documentElement. Built
  // fresh per call so the fast path's `textContent = ''` can't leak between
  // assertions.
  function makeTree() {
    let doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML = '<div id="host"><p>hello</p><span title="$& $1">chars</span></div>';
    return doc.documentElement;
  }

  // The reassembly the fast path replaces, kept verbatim so the equality test
  // below is a real comparison and not a restatement of the new code.
  function reassemble(docElement, shadowRootElements) {
    let innerHTML = docElement.getHTML({ serializableShadowRoots: true, shadowRoots: shadowRootElements });
    docElement.textContent = '';
    return docElement.outerHTML.replace('</html>', () => `${innerHTML}</html>`);
  }

  it('produces byte-identical output to the reassembled form with no shadow roots', () => {
    expect(getOuterHTML(makeTree(), { shadowRootElements: [] }))
      .toBe(reassemble(makeTree(), []));
  });

  it('releases the clone node graph on the fast path', () => {
    // The reassembly path empties docElement as a side effect; the fast path
    // has to do the same or the whole clone stays reachable while the caller
    // builds the doctype concatenation and any stringified copy on top of it.
    let docElement = makeTree();
    getOuterHTML(docElement, { shadowRootElements: [] });
    expect(docElement.childNodes.length).toBe(0);
  });

  it('serializes shadow roots absent from shadowRootElements when told the clone may hold them', () => {
    // getHTML's `serializableShadowRoots: true` picks up roots attached with
    // `serializable: true` even when they are not in the explicit array, so an
    // empty array alone must not gate the fast path.
    let docElement = makeTree();
    let shadow = docElement.querySelector('#host').attachShadow({ mode: 'open', serializable: true });
    shadow.innerHTML = '<b>inside shadow</b>';

    let html = getOuterHTML(docElement, {
      shadowRootElements: [],
      cloneMayHaveUncountedShadowRoots: true
    });

    expect(html).toContain('inside shadow');
    expect(html).toContain('<template shadowrootmode="open"');
  });

  it('returns outerHTML directly when forceShadowAsLightDOM is set', () => {
    let docElement = makeTree();
    expect(getOuterHTML(docElement, { shadowRootElements: [], forceShadowAsLightDOM: true }))
      .toBe(docElement.outerHTML);
  });
});
