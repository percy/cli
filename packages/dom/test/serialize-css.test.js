import { withExample, withCSSOM, parseDOM, withShadowCSSOM, withShadowExample, getExampleShadowRoot, parseDeclShadowDOM, isShadowMode } from './helpers';
import serializeDOM from '@percy/dom';

let shadowDom = isShadowMode;
describe('serializeCSSOM', () => {
  let dom = document;
  beforeEach(() => {
    let link = '<link rel="stylesheet" href="data:text/css,.box { margin: 10px; }"/>';
    let mod = '<style id="mod">.box { width: 500px; }</style>';
    let style = '<style>.box { background: green; }</style>';

    const html = `<div class="box"></div>${link}${mod}${style}`;
    const css = '.box { height: 500px; }';

    if (shadowDom) {
      withShadowExample(html);
      withShadowCSSOM(css);
      dom = getExampleShadowRoot();
    } else {
      withExample(html);
      withCSSOM(css);
    }

    let modCSSRule = dom.getElementById('mod').sheet.cssRules[0];
    if (modCSSRule) modCSSRule.style.cssText = 'width: 1000px';

    // give the linked style a few milliseconds to load
    return new Promise(r => setTimeout(r, 100));
  });

  it('serializes CSSOM and does not mutate the orignal DOM', () => {
    let $ = shadowDom ? parseDeclShadowDOM(serializeDOM()) : parseDOM(serializeDOM());
    let $cssom = $('[data-percy-cssom-serialized]');

    // linked and unmodified stylesheets are not included
    expect($cssom).toHaveSize(2);
    expect($cssom[0].innerHTML).toBe('.box { height: 500px; }');
    expect($cssom[1].innerHTML).toBe('.box { width: 1000px; }');

    expect(dom.styleSheets[0].ownerNode.innerText).toBe('');
    expect(dom.styleSheets[1].ownerNode.innerText).toBe('');
    expect(dom.styleSheets[2].ownerNode.innerText).toBe('.box { width: 500px; }');
    expect(dom.styleSheets[3].ownerNode.innerText).toBe('.box { background: green; }');
    expect(dom.querySelectorAll('[data-percy-cssom-serialized]')).toHaveSize(0);
  });

  it('does not break the CSSOM by adding new styles after serializing', () => {
    let cssomSheet = dom.styleSheets[0];

    // serialize DOM
    serializeDOM();

    // delete the old rule and create a new one
    cssomSheet.deleteRule(0);
    cssomSheet.insertRule('.box { height: 200px; width: 200px; background-color: blue; }');

    expect(cssomSheet.cssRules).toHaveSize(1);
    expect(cssomSheet.cssRules[0].cssText)
      .toBe('.box { height: 200px; width: 200px; background-color: blue; }');
  });

  it('does not serialize the CSSOM when JS is enabled', () => {
    const serializedDOM = serializeDOM({ enableJavaScript: true })
    let $ = shadowDom ? parseDeclShadowDOM(serializedDOM) : parseDOM(serializedDOM);
    expect(dom.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect($('[data-percy-cssom-serialized]')).toHaveSize(0);
  });
});
