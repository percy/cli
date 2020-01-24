import expect from 'expect';
import cheerio from 'cheerio';
import { withExample, withCSSOM } from './helpers';
import serializeDOM from '../src';

describe('serializeCSSOM', () => {
  beforeEach(() => {
    withExample('<div class="box"></div><style>div { display: inline-block; }</style>');
    withCSSOM('.box { height: 500px; width: 500px; background-color: green; }');
  });

  it('serializes CSSOM and does not mutate the orignal DOM', () => {
    let $cssom = cheerio.load(serializeDOM())('[data-percy-cssom-serialized]');

    expect($cssom).toHaveLength(1);
    expect($cssom.html()).toBe('.box { height: 500px; width: 500px; background-color: green; }');
    expect(document.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect(document.querySelectorAll('[data-percy-cssom-serialized]')).toHaveLength(0);
  });

  it('does not serialize CSSOM that exists outside of memory', () => {
    let $css = cheerio.load(serializeDOM())('style');

    expect($css).toHaveLength(3);
    expect($css.eq(0).html()).toBe('.box { height: 500px; width: 500px; background-color: green; }');
    expect($css.eq(0).attr('data-percy-cssom-serialized')).toBeDefined();
    // style #2 (index 1) is the original injected style tag for `withCSSOM`
    expect($css.eq(2).html()).toBe('div { display: inline-block; }');
    expect($css.eq(2).attr('data-percy-cssom-serialized')).toBeUndefined();
  });

  it('does not break the CSSOM by adding new styles after serializng', () => {
    let cssomSheet = document.styleSheets[0];

    // serialize DOM
    serializeDOM();

    // delete the old rule and create a new one
    cssomSheet.deleteRule(0);
    cssomSheet.insertRule('.box { height: 200px; width: 200px; background-color: blue; }');

    expect(cssomSheet.cssRules).toHaveLength(1);
    expect(cssomSheet.cssRules[0].cssText)
      .toBe('.box { height: 200px; width: 200px; background-color: blue; }');
  });

  it('does not break the CSSOM with white space in the style tag', () => {
    withCSSOM(
      '.box { height: 500px; width: 500px; background-color: green; }',
      $style => ($style.innerText = '    ')
    );

    let $ = cheerio.load(serializeDOM());
    let $cssom = $('[data-percy-cssom-serialized]');

    expect($cssom).toHaveLength(1);
    expect($cssom.html()).toBe('.box { height: 500px; width: 500px; background-color: green; }');
  });

  it('does not serialize the CSSOM when JS is enabled', () => {
    let $ = cheerio.load(serializeDOM({ enableJavaScript: true }));
    expect(document.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
    expect($('[data-percy-cssom-serialized]')).toHaveLength(0);
  });
});
