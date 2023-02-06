import { withExample, withCSSOM, parseDOM, platforms, platformDOM, createShadowEl } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeCSSOM', () => {
  beforeEach(() => {
    let link = '<link rel="stylesheet" href="data:text/css,.box { margin: 10px; }"/>';
    let mod = '<style id="mod">.box { width: 500px; }</style>';
    let style = '<style>.box { background: green; }</style>';

    withExample(`<div class="box"></div>${link}${mod}${style}`);
    withCSSOM('.box { height: 500px; }');

    platforms.forEach((platform) => {
      let modCSSRule = platformDOM(platform).getElementById('mod').sheet.cssRules[0];
      if (modCSSRule) modCSSRule.style.cssText = 'width: 1000px';
    });

    // give the linked style a few milliseconds to load
    return new Promise(r => setTimeout(r, 100));
  });

  platforms.forEach((platform) => {
    let dom;
    beforeEach(() => {
      dom = platformDOM(platform);
    });

    it(`${platform}: serializes CSSOM and does not mutate the orignal DOM`, () => {
      let $cssom = parseDOM(serializeDOM(), platform)('[data-percy-cssom-serialized]');

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

    it(`${platform}: does not break the CSSOM by adding new styles after serializing`, () => {
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

    it(`${platform}: does not serialize the CSSOM when JS is enabled`, () => {
      const serializedDOM = serializeDOM({ enableJavaScript: true });
      let $ = parseDOM(serializedDOM, platform);
      expect(dom.styleSheets[0]).toHaveProperty('ownerNode.innerText', '');
      expect($('[data-percy-cssom-serialized]')).toHaveSize(0);
    });

    it('captures adoptedStylesheets', () => {
      if (platform === 'plain') {
        return;
      }

      withExample('<div id="box"></div>', { withShadow: false });
      const box = document.querySelector('#box');
      const sheet = new window.CSSStyleSheet();
      sheet.replaceSync('p { color: blue; }');
      const shadowEl = createShadowEl();
      shadowEl.shadowRoot.adoptedStyleSheets = [sheet];
      box.appendChild(shadowEl);

      let $ = parseDOM(serializeDOM(), 'plain');

      const resultShadowEl = $('#Percy-0')[0];
      // console.log(shadowRoot.children)
      expect(resultShadowEl.innerHTML).toEqual([
        '<template shadowroot="open">',
        '<style>p { color: blue; }</style>',
        '<p>Percy-0</p>',
        '</template>'
      ].join(''));
    });
  });
});
