import { withExample, withCSSOM, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeCSSOM', () => {
  beforeEach(() => {
    withExample('<div class="box"></div><style>div { display: inline-block; }</style>');
    withCSSOM('.box { height: 500px; width: 500px; background-color: green; }');
  });

  it('serializes CSSOM and does not mutate the orignal DOM', () => {
    let $cssom = parseDOM(serializeDOM())('[data-percy-cssom-serialized]');

    expect($cssom).toHaveSize(1);
    expect($cssom[0].innerHTML).toBe('.box { height: 500px; width: 500px; background-color: green; }');
    expect(document.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect(document.querySelectorAll('[data-percy-cssom-serialized]')).toHaveSize(0);
  });

  it('does not serialize CSSOM that exists outside of memory', () => {
    let $css = parseDOM(serializeDOM())('style');

    expect($css).toHaveSize(3);
    expect($css[0].innerHTML).toBe('.box { height: 500px; width: 500px; background-color: green; }');
    expect($css[0].getAttribute('data-percy-cssom-serialized')).toBeDefined();
    // style #2 (index 1) is the original injected style tag for `withCSSOM`
    expect($css[2].innerHTML).toBe('div { display: inline-block; }');
    expect($css[2].getAttribute('data-percy-cssom-serialized')).toBeNull();
  });

  it('does not break the CSSOM by adding new styles after serializng', () => {
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

  it('does not break the CSSOM with white space in the style tag', () => {
    withCSSOM(
      '.box { height: 500px; width: 500px; background-color: green; }',
      $style => ($style.innerText = '    ')
    );

    let $ = parseDOM(serializeDOM());
    let $cssom = $('[data-percy-cssom-serialized]');

    expect($cssom).toHaveSize(1);
    expect($cssom[0].innerHTML).toBe('.box { height: 500px; width: 500px; background-color: green; }');
  });

  it('does not serialize the CSSOM when JS is enabled', () => {
    let $ = parseDOM(serializeDOM({ enableJavaScript: true }));
    expect(document.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect($('[data-percy-cssom-serialized]')).toHaveSize(0);
  });
});
