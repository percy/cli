import { withExample, withCSSOM, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeCSSOM', () => {
  beforeEach(() => {
    let link = '<link rel="stylesheet" href="data:text/css,.box { margin: 10px; }"/>';
    let style = '<style>.box { display: inline-block; }</style>';

    withExample(`<div class="box"></div>${link}${style}`);
    withCSSOM('.box { height: 500px; width: 500px; background-color: green; }');
  });

  it('serializes CSSOM and does not mutate the orignal DOM', () => {
    let $cssom = parseDOM(serializeDOM())('[data-percy-cssom-serialized]');

    // linked stylesheet is not included
    expect($cssom).toHaveSize(2);
    expect($cssom[0].innerHTML).toBe('.box { height: 500px; width: 500px; background-color: green; }');
    expect($cssom[1].innerHTML).toBe('.box { display: inline-block; }');
    expect(document.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect(document.querySelectorAll('[data-percy-cssom-serialized]')).toHaveSize(0);
  });

  it('does not break the CSSOM by adding new styles after serializing', () => {
    let cssomSheet = document.styleSheets[0];

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
    let $ = parseDOM(serializeDOM({ enableJavaScript: true }));
    expect(document.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect($('[data-percy-cssom-serialized]')).toHaveSize(0);
  });
});
