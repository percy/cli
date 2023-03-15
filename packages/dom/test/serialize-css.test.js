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

    it('captures adoptedStylesheets inside document', () => {
      if (platform !== 'plain') {
        return;
      }
      withExample('<div>AdoptedStyle</div>', { withShadow: false });
      const sheet = new window.CSSStyleSheet();
      const style = 'div { background: blue; }';
      sheet.replaceSync(style);
      dom.adoptedStyleSheets = [sheet];
      const capture = serializeDOM();
      let $ = parseDOM(capture, 'plain');
      dom.adoptedStyleSheets = [];
      expect($('body')[0].innerHTML).toMatch(`<link rel="stylesheet" data-percy-adopted-stylesheets-serialized="true" href="${capture.resources[0].url}">`);
    });

    it('captures adoptedStylesheets', () => {
      if (platform === 'plain') {
        return;
      }

      withExample('<div id="box"></div>', { withShadow: false });
      const box = document.querySelector('#box');
      const sheet = new window.CSSStyleSheet();
      const style = 'p { color: blue; }';
      sheet.replaceSync(style);
      const shadowEl = createShadowEl();
      shadowEl.shadowRoot.adoptedStyleSheets = [sheet];
      box.appendChild(shadowEl);

      const capture = serializeDOM();
      let $ = parseDOM(capture, 'plain');

      const resultShadowEl = $('#Percy-0')[0];
      expect(capture.resources).toEqual(jasmine.arrayContaining([{
        url: jasmine.stringMatching('\\.css$'),
        content: style,
        mimetype: 'text/css'
      }]));

      expect(resultShadowEl.innerHTML).toEqual([
        '<template shadowroot="open">',
        `<link rel="stylesheet" data-percy-adopted-stylesheets-serialized="true" href="${capture.resources[0].url}">`,
        '<p>Percy-0</p>',
        '</template>'
      ].join(''));

      shadowEl.shadowRoot.adoptedStyleSheets = [];
    });

    it('uses single resource for same adoptedStylesheet', () => {
      if (platform === 'plain') {
        return;
      }

      withExample('<div id="box"></div>', { withShadow: false });
      const box = document.querySelector('#box');
      const sheet = new window.CSSStyleSheet();
      const style = 'p { color: blue; }';
      sheet.replaceSync(style);
      const sheet2 = new window.CSSStyleSheet();
      const style2 = 'div {border: 1px solid black;}';
      sheet2.replaceSync(style2);
      const shadowEl = createShadowEl();
      const shadowElChild = createShadowEl(1);
      shadowEl.shadowRoot.adoptedStyleSheets = [sheet];
      shadowElChild.shadowRoot.adoptedStyleSheets = [sheet, sheet2];

      shadowEl.appendChild(shadowElChild);
      box.appendChild(shadowEl);

      const capture = serializeDOM();
      expect(capture.resources.length).toEqual(2);

      let $ = parseDOM(capture, 'plain');

      const resultShadowEl = $('#Percy-0')[0];
      const resultShadowElChild = $('#Percy-1')[0];

      expect(resultShadowEl.innerHTML).toMatch([
        '<template shadowroot="open">',
        `<link rel="stylesheet" data-percy-adopted-stylesheets-serialized="true" href="${capture.resources[0].url}">`,
        '<p>Percy-0</p>',
        '</template>'
      ].join(''));

      expect(resultShadowElChild.innerHTML).toMatch([
        '<template shadowroot="open">',
        `<link rel="stylesheet" data-percy-adopted-stylesheets-serialized="true" href="${capture.resources[1].url}">`,
        `<link rel="stylesheet" data-percy-adopted-stylesheets-serialized="true" href="${capture.resources[0].url}">`,
        '<p>Percy-1</p>',
        '</template>'
      ].join(''));

      shadowEl.shadowRoot.adoptedStyleSheets = [];
      shadowElChild.shadowRoot.adoptedStyleSheets = [];
    });
  });
});
