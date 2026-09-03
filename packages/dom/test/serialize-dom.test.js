import { withExample, replaceDoctype, createShadowEl, getTestBrowser, chromeBrowser, parseDOM, createAndAttachSlotTemplate } from './helpers';
import serializeDOM, { waitForResize } from '@percy/dom';
import { getClosedShadowRoot, hasClosedShadowRoot } from '../src/shadow-utils';

describe('serializeDOM', () => {
  it('returns serialied html, warnings, and resources', () => {
    expect(serializeDOM()).toEqual({
      html: jasmine.any(String),
      cookies: jasmine.any(String),
      userAgent: jasmine.any(String),
      warnings: jasmine.any(Array),
      resources: jasmine.any(Array),
      hints: jasmine.any(Array)
    });
  });

  it('keeps replace special chars as is and does not replace with regex rules', () => {
    withExample('<p>Hey Percy $&</p>');

    const result = serializeDOM();
    expect(result.html).toContain('Hey Percy $&');
  });

  it('excludes noscript tags when present', () => {
    withExample('<p>Hey Percy $&</p><noscript>Your browser does not support JavaScript!</noscript>');

    const result = serializeDOM();
    expect(result.html).not.toContain('<noscript>');
    expect(result.html).toContain('Hey Percy $&');
  });

  it('optionally returns a stringified response', () => {
    expect(serializeDOM({ stringifyResponse: true }))
      .toMatch('{"html":".*","cookies":".*","userAgent":".*","warnings":\\[.*\\],"resources":\\[\\],"hints":\\[\\]}');
  });

  it('always has a doctype', () => {
    document.removeChild(document.doctype);
    expect(serializeDOM().html).toMatch('<!DOCTYPE html>');
  });

  it('copies existing doctypes', () => {
    let publicId = '-//W3C//DTD XHTML 1.0 Transitional//EN';
    let systemId = 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtdd';

    replaceDoctype('html', publicId);
    expect(serializeDOM().html).toMatch(`<!DOCTYPE html PUBLIC "${publicId}">`);
    replaceDoctype('html', '', systemId);
    expect(serializeDOM().html).toMatch(`<!DOCTYPE html SYSTEM "${systemId}">`);
    replaceDoctype('html', publicId, systemId);
    expect(serializeDOM().html).toMatch(`<!DOCTYPE html PUBLIC "${publicId}" "${systemId}">`);
    replaceDoctype('html');
    expect(serializeDOM().html).toMatch('<!DOCTYPE html>');
  });

  it('does not trigger DOM events on clone', () => {
    class CallbackTestElement extends window.HTMLElement {
      connectedCallback() {
        const wrapper = document.createElement('h2');
        wrapper.className = 'callback';
        wrapper.innerText = 'Test';
        this.appendChild(wrapper);
      }
    }

    if (!window.customElements.get('callback-test')) {
      window.customElements.define('callback-test', CallbackTestElement);
    }
    withExample('<callback-test/>', { withShadow: false });
    const $ = parseDOM(serializeDOM().html);

    expect($('h2.callback').length).toEqual(1);
  });

  it('does not flag closed shadow roots as inaccessible when disableShadowDOM is set', () => {
    if (!window.customElements.get('percy-opted-out')) {
      class PercyOptedOut extends window.HTMLElement {
        connectedCallback() { this.innerHTML = '<span>opted out</span>'; }
      }
      window.customElements.define('percy-opted-out', PercyOptedOut);
    }
    withExample('<percy-opted-out id="poo"></percy-opted-out>', { withShadow: false });
    let el = document.getElementById('poo');
    let origMap = window.__percyClosedShadowRoots;
    let map = new WeakMap();
    map.set(el, {});
    window.__percyClosedShadowRoots = map;

    let result = serializeDOM({ disableShadowDOM: true });
    expect(result.warnings.some(w => w.includes('[capture]') && w.includes('potentially inaccessible'))).toBe(false);

    window.__percyClosedShadowRoots = origMap;
  });

  it('applies default dom transformations', () => {
    withExample('<img loading="lazy" src="http://some-url"/><iframe loading="lazy" src="">');

    const result = serializeDOM();
    expect(result.html).not.toContain('loading="lazy"');
  });

  it('collects cookies', () => {
    const result = serializeDOM();
    expect(result.cookies).toContain('test-cokkie=test-value');
  });

  it('collects userAgent', () => {
    const result = serializeDOM();
    expect(result.userAgent).toContain(navigator.userAgent);
  });

  it('serializes base element correctly without string coercion', () => {
    withExample('<head><base href="/"></head><body><p>Test</p></body>');

    const result = serializeDOM();
    const $ = parseDOM(result.html);

    // Should NOT contain the string representation of the object
    expect(result.html).not.toContain('[object HTMLBaseElement]');
    expect(result.html).not.toContain('[object');

    // Should contain properly serialized base element
    expect($('base').length).toEqual(1);
    expect($('base')[0].getAttribute('href')).toEqual('/');
  });

  it('preserves base element attributes', () => {
    withExample('<head><base href="https://example.com/" target="_blank"></head>');

    const result = serializeDOM();
    const $ = parseDOM(result.html);

    expect($('base')[0].getAttribute('href')).toEqual('https://example.com/');
    expect($('base')[0].getAttribute('target')).toEqual('_blank');
    expect(result.html).not.toContain('[object');
  });

  it('clone node is always shallow', () => {
    class AttributeCallbackTestElement extends window.HTMLElement {
      static get observedAttributes() {
        return ['text'];
      }

      attributeChangedCallback() {
        const wrapper = document.createElement('h2');
        wrapper.className = 'callback';
        wrapper.innerText = 'Test';
        this.appendChild(wrapper);
      }
    }

    if (!window.customElements.get('attr-callback-test')) {
      window.customElements.define('attr-callback-test', AttributeCallbackTestElement);
    }
    withExample('<attr-callback-test text="1"/>', { withShadow: false });
    const $ = parseDOM(serializeDOM().html);

    expect($('h2.callback').length).toEqual(1);
  });

  describe('shadow dom', () => {
    it('renders open root as template tag', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }

      withExample('<div id="content"></div>', false);
      const contentEl = document.querySelector('#content');
      const shadow = contentEl.attachShadow({ mode: 'open' });
      const paragraphEl = document.createElement('p');
      paragraphEl.textContent = 'Hey Percy!';
      shadow.appendChild(paragraphEl);

      const html = serializeDOM().html;
      expect(html).toMatch('<template shadowrootmode="open" shadowrootserializable="">');
      expect(html).toMatch('Hey Percy!');
    });

    it('does not render closed root', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }

      withExample('<div id="content"></div>', { withShadow: false });
      const contentEl = document.querySelector('#content');
      const shadow = contentEl.attachShadow({ mode: 'closed' });
      const paragraphEl = document.createElement('p');
      paragraphEl.textContent = 'Hey Percy!';
      shadow.appendChild(paragraphEl);

      const html = serializeDOM().html;
      expect(html).not.toMatch('<template shadowroot');
      expect(html).not.toMatch('Hey Percy!');
    });

    it('renders single nested', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }

      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');

      const el1 = createShadowEl(1);
      const el2 = createShadowEl(2);
      el1.shadowRoot.appendChild(el2);
      baseContent.append(el1);

      const html = serializeDOM().html;

      expect(html).toMatch(new RegExp([
        '<template shadowrootmode="open" shadowrootserializable="">',
        '<p>Percy-1</p>',
        '<div id="Percy-2" .*>',
        '<template shadowrootmode="open" shadowrootserializable="">',
        '<p>Percy-2</p>',
        '</template>'
      ].join('')));
    });

    it('renders many nested', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');

      const levels = 1000;

      let j = levels, el = null;
      let matchRegex = '';

      while (j--) {
        let newEl = createShadowEl(j);
        if (el) {
          el.shadowRoot.appendChild(newEl);
        } else {
          baseContent.appendChild(newEl);
        }
        el = newEl;
        matchRegex += [
          `<div id="Percy-${j}" .*>`,
          '<template shadowrootmode="open" shadowrootserializable="">',
          `<p>Percy-${j}</p>`
        ].join('');
      }

      const html = serializeDOM().html;
      expect(html).toMatch(new RegExp(matchRegex));
    });

    it('renders many flat', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');

      const levels = 1000;

      let j = levels, matchRegex = '';

      while (j--) {
        let newEl = createShadowEl(j);
        baseContent.appendChild(newEl);
        matchRegex += [
          `<div id="Percy-${j}" .*>`,
          '<template shadowrootmode="open" shadowrootserializable="">',
          `<p>Percy-${j}</p>`,
          '</template>',
          '</div>'
        ].join('');
      }

      const html = serializeDOM().html;
      expect(html).toMatch(new RegExp(matchRegex));
    });

    it('respects disableShadowDOM', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      const el = createShadowEl(8);
      baseContent.appendChild(el);

      const html = serializeDOM({ disableShadowDOM: true }).html;
      expect(html).not.toMatch('<p>Percy-8</p>');
      expect(html).not.toMatch('data-percy-shadow-host=');
    });

    it('renders custom elements properly', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }
      class TestElement extends window.HTMLElement {
        constructor() {
          super();
          // Create a shadow root
          const shadow = this.shadowRoot || this.attachShadow({ mode: 'open', serializable: true });
          const wrapper = document.createElement('h2');
          wrapper.innerText = 'Test';
          shadow.appendChild(wrapper);
        }
      }

      window.customElements.define('test-elem', TestElement);

      withExample('<test-elem/>', { withShadow: false });
      const html = serializeDOM().html;
      expect(html).toMatch('<h2>Test</h2>');
    });

    it('warns if data-percy-shadow-host incorrectly marked', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content" data-percy-shadow-host=""></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      baseContent.innerHTML = '<input type="text>';
      const serialized = serializeDOM();
      expect(serialized.warnings).toContain('data-percy-shadow-host does not have shadowRoot');
    });

    it('renders slot template with shadowrootmode open', () => {
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      createAndAttachSlotTemplate(baseContent);

      const html = serializeDOM().html;
      expect(html).toMatch('<template shadowrootmode="open">');
      expect(html).toMatch('<p slot="title">Hello from the title slot!</p>');
      expect(html).toMatch('<p>This content is distributed into the default slot.</p>');

      // Check styles patterns independently
      expect(html).toMatch(/<style[^>]*data-percy-element-id="[^"]*"[^>]*>/);
      expect(html).toMatch(/:host\s*{[^}]*}/);
      expect(html).toMatch(/::slotted\(\[slot="title"\]\)\s*{[^}]*}/);
      expect(html).toMatch(/::slotted\(\*\)\s*{[^}]*}/);
    });

    it('respects forceShadowAsLightDOM for single element', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      const el = createShadowEl(9);
      baseContent.appendChild(el);

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;
      expect(html).toMatch('<p>Percy-9</p>');
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('shadowrootserializable');
      expect(html).not.toMatch('data-percy-shadow-host');
    });

    it('respects forceShadowAsLightDOM for nested shadow elements', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');

      const el1 = createShadowEl(10);
      const el2 = createShadowEl(11);
      el1.shadowRoot.appendChild(el2);
      baseContent.append(el1);

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;
      expect(html).toMatch('<p>Percy-10</p>');
      expect(html).toMatch('<p>Percy-11</p>');
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('shadowrootserializable');
      expect(html).not.toMatch('data-percy-shadow-host');
    });

    it('respects forceShadowAsLightDOM for custom elements', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }

      class ForceShadowTestElement extends window.HTMLElement {
        constructor() {
          super();
          const shadow = this.attachShadow({ mode: 'open', serializable: true });
          const wrapper = document.createElement('h3');
          wrapper.innerText = 'Force Shadow Test';
          const nested = document.createElement('span');
          nested.innerText = 'Nested Content';
          wrapper.appendChild(nested);
          shadow.appendChild(wrapper);
        }
      }

      if (!window.customElements.get('force-shadow-test')) {
        window.customElements.define('force-shadow-test', ForceShadowTestElement);
      }

      withExample('<force-shadow-test></force-shadow-test>', { withShadow: false });
      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;

      expect(html).toMatch('<h3>Force Shadow Test<span>Nested Content</span></h3>');
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('shadowrootserializable');
    });

    it('respects forceShadowAsLightDOM with many flat elements', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');

      const levels = 50; // Reduced for performance in tests

      let j = levels;

      while (j--) {
        let newEl = createShadowEl(j);
        baseContent.appendChild(newEl);
      }

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;

      // Verify all content is present as light DOM
      for (let i = 0; i < levels; i++) {
        expect(html).toMatch(`<p>Percy-${i}</p>`);
      }
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('shadowrootserializable');
      expect(html).not.toMatch('data-percy-shadow-host');
    });

    it('respects forceShadowAsLightDOM with slot content', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');

      // Create element with slot
      const hostEl = document.createElement('div');
      const shadow = hostEl.attachShadow({ mode: 'open' });

      const slot = document.createElement('slot');
      slot.name = 'title';
      shadow.appendChild(slot);

      const slottedContent = document.createElement('p');
      slottedContent.setAttribute('slot', 'title');
      slottedContent.textContent = 'Slotted content as light DOM';
      hostEl.appendChild(slottedContent);

      baseContent.appendChild(hostEl);

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;

      // When forceShadowAsLightDOM is true, shadow content becomes light DOM
      // The slot element from shadow DOM will be present, and slotted content remains in light DOM
      expect(html).toMatch('Slotted content as light DOM');
      expect(html).toMatch('<slot name="title"></slot>');
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('shadowrootserializable');
    });

    it('disableShadowDOM takes precedence over forceShadowAsLightDOM', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      const el = createShadowEl(12);
      baseContent.appendChild(el);

      // When both flags are set, disableShadowDOM takes precedence and no shadow content is processed at all
      // This is because disableShadowDOM prevents shadow DOM cloning entirely in clone-dom.js
      const html = serializeDOM({
        disableShadowDOM: true,
        forceShadowAsLightDOM: true
      }).html;

      expect(html).not.toMatch('<p>Percy-12</p>');
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('data-percy-shadow-host');
    });

    it('forceShadowAsLightDOM works independently when disableShadowDOM is false', () => {
      if (!navigator.userAgent.toLowerCase().includes('chrome')) {
        return;
      }
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      const el = createShadowEl(14);
      baseContent.appendChild(el);

      // When only forceShadowAsLightDOM is true, shadow content should be rendered as light DOM
      const html = serializeDOM({
        disableShadowDOM: false,
        forceShadowAsLightDOM: true
      }).html;

      expect(html).toMatch('<p>Percy-14</p>');
      expect(html).not.toMatch('<template shadowrootmode="open"');
      expect(html).not.toMatch('data-percy-shadow-host');
    });
  });

  it('renders custom image elements with src attribute properly', () => {
    if (getTestBrowser() !== chromeBrowser) {
      return;
    }

    class CustomImage extends window.HTMLElement {
      static get observedAttributes() {
        return ['src'];
      }

      constructor() {
        super();
        this.img = document.createElement('img');
        this.appendChild(this.img);
      }

      attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'src') {
          this.img.src = newValue || '';
        }
      }
    }

    window.customElements.define('custom-image', CustomImage);

    withExample(`
        <custom-image src="https://example.com/test.jpg"></custom-image>
      `, { withShadow: false });

    const html = serializeDOM().html;

    expect(html).toMatch(
      /<custom-image[^>]*><img src="https:\/\/example\.com\/test\.jpg"><\/custom-image>/
    );
  });

  describe('with `domTransformation`', () => {
    beforeEach(() => {
      withExample('<span class="delete-me">Delete me</span>', { withShadow: false });
      spyOn(console, 'error');
    });

    it('transforms the DOM without modifying the original DOM', () => {
      let { html } = serializeDOM({
        domTransformation(dom) {
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(html).not.toMatch('Delete me');
      expect(document.querySelector('.delete-me').innerText).toBe('Delete me');
    });

    it('String: transforms the DOM without modifying the original DOM', () => {
      let { html } = serializeDOM({
        domTransformation: "(dom) => { dom.querySelector('.delete-me').remove(); }"
      });

      expect(html).not.toMatch('Delete me');
      expect(document.querySelector('.delete-me').innerText).toBe('Delete me');
    });

    it('String: Logs error when function is not correct', () => {
      let { html, warnings } = serializeDOM({
        domTransformation: "(dom) => { dom.querySelector('.delete-me').delete(); }"
      });

      expect(html).toMatch('Delete me');
      expect(console.error)
        .toHaveBeenCalledOnceWith('Could not transform the dom: dom.querySelector(...).delete is not a function');

      expect(warnings).toEqual(['Could not transform the dom: dom.querySelector(...).delete is not a function']);
    });

    it('logs any errors and returns the serialized DOM', () => {
      let { html, warnings } = serializeDOM({
        domTransformation(dom) {
          throw new Error('test error');
          // eslint-disable-next-line no-unreachable
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(html).toMatch('Delete me');
      expect(console.error)
        .toHaveBeenCalledOnceWith('Could not transform the dom: test error');

      expect(warnings).toEqual(['Could not transform the dom: test error']);
    });

    // A domTransformation runs after serializeElements() has already collected
    // ctx.shadowRootElements, so a shadow root attached here is invisible to
    // that array. getOuterHTML must not take its no-shadow-roots fast path for
    // these snapshots, or the shadow content is silently dropped.
    it('serializes a shadow root attached during the transformation', () => {
      let { html } = serializeDOM({
        domTransformation(dom) {
          let host = dom.querySelector('.delete-me');
          let shadow = host.attachShadow({ mode: 'open', serializable: true });
          shadow.innerHTML = '<p>shadow added by transformation</p>';
        }
      });

      expect(html).toContain('shadow added by transformation');
      expect(html).toContain('<template shadowrootmode="open"');
    });
  });

  describe('marker un-mangling', () => {
    it('restores both the tag and attribute markers in one pass', () => {
      if (getTestBrowser() !== chromeBrowser) {
        return;
      }

      // Both markers have to land in the SAME tag for this to exercise the
      // single-pass replacer's branch discrimination. That needs a custom
      // element that cloneElementWithoutLifecycle proxies — i.e. one with an
      // attributeChangedCallback — carrying a `src`, which is the attribute it
      // rewrites to data-percy-serialized-attribute-src. A plain undefined
      // element takes the cloneNode() branch and emits no markers at all.
      class MarkerWidget extends window.HTMLElement {
        static get observedAttributes() {
          return ['src'];
        }

        attributeChangedCallback() {}
      }

      if (!window.customElements.get('marker-widget')) {
        window.customElements.define('marker-widget', MarkerWidget);
      }

      withExample('<marker-widget src="/img.png"></marker-widget>', { withShadow: false });

      let { html } = serializeDOM();

      expect(html).toContain('<marker-widget src="/img.png"');
      expect(html).not.toContain('data-percy-custom-element-');
      expect(html).not.toContain('data-percy-serialized-attribute-');
    });

    it('restores the attribute marker written by canvas serialization', () => {
      // serialize-canvas sets data-percy-serialized-attribute-src; if the
      // attribute branch of the merged regex regressed, the marker would ship.
      withExample('<canvas id="canvas" width="10" height="10"></canvas>', { withShadow: false });
      let ctx = document.getElementById('canvas').getContext('2d');
      ctx.fillRect(0, 0, 10, 10);

      let { html } = serializeDOM();

      expect(html).not.toContain('data-percy-serialized-attribute-');
      expect(html).toMatch(/<img[^>]+src="[^"]+"/);
    });
  });

  describe('with `reshuffleInvalidTags`', () => {
    beforeEach(() => {
      withExample('', { withShadow: false, invalidTagsOutsideBody: true });
    });

    it('does not reshuffle tags outside </body>', () => {
      const result = serializeDOM();
      expect(result.html).toContain('P tag outside body');
      expect(result.hints).toEqual(['DOM elements found outside </body>']);
    });

    it('reshuffles tags outside </body>', () => {
      const result = serializeDOM({ reshuffleInvalidTags: true });
      expect(result.html).toContain('P tag outside body');
      expect(result.hints).toEqual([]);
    });
  });

  describe('when `ctx.clone.body` is null for about:blank pages', () => {
    beforeEach(() => {
      withExample('', { withoutBody: true });
    });

    it('does not add hints and does not throw an error', () => {
      expect(() => {
        const result = serializeDOM();
        expect(result.hints).toEqual([]);
      }).not.toThrow();
    });
  });

  describe('waitForResize', () => {
    it('updates window.resizeCount', async () => {
      waitForResize();
      expect(window.resizeCount).toEqual(0);
      // trigger resize event
      // eslint-disable-next-line no-undef
      window.dispatchEvent(new Event('resize'));
      // eslint-disable-next-line no-undef
      window.dispatchEvent(new Event('resize'));
      // should be only updated once in 100ms
      await new Promise((r) => setTimeout(r, 150));
      expect(window.resizeCount).toEqual(1);
      waitForResize();
      expect(window.resizeCount).toEqual(0);
      // eslint-disable-next-line no-undef
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 150));
      // there should only one event listener added
      expect(window.resizeCount).toEqual(1);
    });
  });

  describe('error handling', () => {
    it('adds node details in error message and rethrow it', () => {
      let oldURL = window.URL;
      window.URL = undefined;
      withExample(`
          <img id="test" class="test1 test2" src="data:image/png;base64,iVBORw0KGgo" alt="Example Image">
          `);

      expect(() => serializeDOM()).toThrowMatching((error) => {
        return error.message.includes('Error cloning node:') &&
            error.message.includes('{"nodeName":"IMG","classNames":"test1 test2","id":"test"}');
      });
      window.URL = oldURL;
    });

    it('ignores canvas serialization errors when flag is enabled', () => {
      withExample(`
          <canvas id="canvas" width="150px" height="150px"/>
        `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('Canvas error'));

      let result = serializeDOM({ ignoreCanvasSerializationErrors: true });
      expect(result.warnings).toContain('Canvas Serialization failed, Replaced canvas with empty Image');
      expect(result.warnings).toContain('Error: Canvas error');
      expect(result.html).toContain('data-percy-canvas-serialized');
    });

    it('picks ignoreCanvasSerializationErrors flag from options', () => {
      withExample(`
          <canvas id="canvas" width="150px" height="150px"/>
        `);

      spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').and.throwError(new Error('Canvas error'));

      let result = serializeDOM({ ignoreCanvasSerializationErrors: true });
      expect(result.html).toContain('data-percy-canvas-serialized');
      expect(result.warnings).toContain('Canvas Serialization failed, Replaced canvas with empty Image');
      expect(result.warnings).toContain('Error: Canvas error');
    });
  });

  describe('closed shadow root capture', () => {
    it('captures closed shadow root content when preflight WeakMap is populated', () => {
      if (getTestBrowser() !== chromeBrowser) return;

      // Simulate preflight: set up the WeakMap
      let map = new WeakMap();
      let origMap = window.__percyClosedShadowRoots;
      window.__percyClosedShadowRoots = map;

      let el = document.createElement('div');
      el.id = 'closed-host';
      // Manually create a closed shadow root and store in WeakMap
      let shadow = el.attachShadow({ mode: 'closed' });
      shadow.innerHTML = '<p>closed content</p>';
      map.set(el, shadow);

      document.getElementById('test')?.remove();
      let $test = document.createElement('div');
      $test.id = 'test';
      $test.appendChild(el);
      document.body.appendChild($test);

      let result = serializeDOM();
      expect(result.html).toContain('closed content');

      // Cleanup
      window.__percyClosedShadowRoots = origMap;
    });

    it('marks closed shadow hosts with data-percy-shadow-host', () => {
      if (getTestBrowser() !== chromeBrowser) return;

      let map = new WeakMap();
      let origMap = window.__percyClosedShadowRoots;
      window.__percyClosedShadowRoots = map;

      let el = document.createElement('div');
      let shadow = el.attachShadow({ mode: 'closed' });
      shadow.innerHTML = '<span>test</span>';
      map.set(el, shadow);

      document.getElementById('test')?.remove();
      let $test = document.createElement('div');
      $test.id = 'test';
      $test.appendChild(el);
      document.body.appendChild($test);

      serializeDOM();
      expect(el.hasAttribute('data-percy-shadow-host')).toBe(true);

      window.__percyClosedShadowRoots = origMap;
    });
  });

  describe('interactive state CSS capture', () => {
    // :checked and :disabled serialize natively — `disabled` is a reflected
    // content attribute and serialize-inputs syncs checked/selected to
    // attributes on the clone. They are neither stamped nor rewritten;
    // copying their rules to the end of <head> flipped !important cascade
    // ties against equal-specificity rules from later stylesheets (PER-10077).
    it('does not mark checked inputs with data-percy-checked', () => {
      withExample('<input type="checkbox" id="cb" checked>', { withShadow: false });
      let result = serializeDOM();
      expect(result.html).not.toContain('data-percy-checked');
    });

    it('does not mark disabled inputs with data-percy-disabled', () => {
      withExample('<input type="text" id="dis" disabled>', { withShadow: false });
      let result = serializeDOM();
      expect(result.html).not.toContain('data-percy-disabled');
    });

    it('does not copy or rewrite :checked CSS rules', () => {
      withExample('<label><input type="checkbox" checked><span>text</span></label>', { withShadow: false });
      let style = document.createElement('style');
      style.textContent = 'input:checked + span { color: green; }';
      document.head.appendChild(style);

      let result = serializeDOM();
      expect(result.html).not.toContain('[data-percy-checked]');

      style.remove();
    });

    it('does not copy or rewrite :disabled CSS rules (PER-10077)', () => {
      withExample('<input type="text" disabled>', { withShadow: false });
      let style = document.createElement('style');
      style.textContent = 'input:disabled { opacity: 0.5; }';
      document.head.appendChild(style);

      let result = serializeDOM();
      expect(result.html).not.toContain('[data-percy-disabled]');

      style.remove();
    });

    it('injects a rewritten :hover copy after its source sheet, not at end of head (PER-10077)', () => {
      // The copy must keep its source sheet's cascade rank: it sits AFTER the
      // sheet it came from but BEFORE any later sheet, so a later equal-
      // specificity rule still wins the tie exactly as in the live browser.
      withExample(
        '<style>.cbtn:hover { color: red }</style>' +
        '<style>.cbtn.later { color: blue }</style>' +
        '<button class="cbtn later">go</button>',
        { withShadow: false }
      );
      let html = serializeDOM({ enablePseudoClassSerialization: true }).html;
      let sourceIdx = html.indexOf('.cbtn:hover');
      let copyIdx = html.indexOf('[data-percy-hover]');
      let laterIdx = html.indexOf('.cbtn.later');
      expect(copyIdx).toBeGreaterThan(-1);
      expect(copyIdx).toBeGreaterThan(sourceIdx); // after its own sheet
      expect(copyIdx).toBeLessThan(laterIdx); // before the later sheet
    });
  });

  describe('interactive-state serialization opt-in gate (PER-10588)', () => {
    const HOVER_PAGE =
      '<style>.gbtn:hover { color: red }</style>' +
      '<button id="gbtn" class="gbtn">go</button>';

    it('is off by default — no rewritten copy and no state stamps', () => {
      withExample(HOVER_PAGE, { withShadow: false });
      let html = serializeDOM().html;
      expect(html).not.toContain('data-percy-interactive-states');
      expect(html).not.toContain('[data-percy-hover]');
      expect(html).not.toContain('data-percy-focus');
    });

    it('is on when enablePseudoClassSerialization is set', () => {
      withExample(HOVER_PAGE, { withShadow: false });
      let html = serializeDOM({ enablePseudoClassSerialization: true }).html;
      expect(html).toContain('data-percy-interactive-states');
      expect(html).toContain('[data-percy-hover]');
    });

    it('accepts the snake_case option name', () => {
      withExample(HOVER_PAGE, { withShadow: false });
      let html = serializeDOM({ enable_pseudo_class_serialization: true }).html;
      expect(html).toContain('[data-percy-hover]');
    });

    it('is on when pseudoClassEnabledElements is configured, without the flag', () => {
      withExample(HOVER_PAGE, { withShadow: false });
      let html = serializeDOM({ pseudoClassEnabledElements: { id: ['gbtn'] } }).html;
      expect(html).toContain('[data-percy-hover]');
      expect(html).toContain('data-percy-pseudo-element-id');
    });

    it('stays on for configured elements even when the flag is materialized false', () => {
      withExample(HOVER_PAGE, { withShadow: false });
      let html = serializeDOM({
        enablePseudoClassSerialization: false,
        pseudoClassEnabledElements: { id: ['gbtn'] }
      }).html;
      expect(html).toContain('[data-percy-hover]');
    });

    it('still stamps open popovers while disabled — the renderer requires it', () => {
      withExample(
        '<div id="gpop" popover="manual">hi</div>',
        { withShadow: false }
      );
      let popover = document.getElementById('gpop');
      if (typeof popover.showPopover !== 'function') return;
      popover.showPopover();

      let html = serializeDOM().html;
      expect(html).not.toContain('data-percy-interactive-states');
      expect(html).toContain('data-percy-popover-open');
    });

    it('still rewrites custom element :state() while disabled', () => {
      withExample(
        '<style>.gstate:state(checked) { color: red }</style><div class="gstate"></div>',
        { withShadow: false }
      );
      let html = serializeDOM().html;
      expect(html).not.toContain('data-percy-interactive-states');
      expect(html).toContain('[data-percy-custom-state~="checked"]');
    });

    it('leaves no data-percy-* state attributes on the live DOM either way', () => {
      withExample(HOVER_PAGE, { withShadow: false });
      serializeDOM({ enablePseudoClassSerialization: true });
      expect(document.querySelector('[data-percy-hover]')).toBeNull();
      expect(document.querySelector('[data-percy-focus]')).toBeNull();
    });
  });

  describe('stylesheet <link> handling (PER-10610)', () => {
    it('leaves a live stylesheet <link> equal to what a head manager rendered', () => {
      withExample('<link rel="stylesheet" href="data:text/css,.lx{color:red}">', { withShadow: false });
      let link = document.querySelector('link[rel="stylesheet"][href^="data:text/css,.lx"]');
      let rendered = link.cloneNode();

      serializeDOM();

      expect(link.isEqualNode(rendered)).toBe(true);
    });

    it('does not stamp stylesheet <link>s in the serialized output', () => {
      withExample(
        '<link rel="stylesheet" href="data:text/css,.lx{color:red}">' +
        '<link rel="preload" as="style" href="data:text/css,.ly{color:red}">' +
        '<link href="data:text/css,.lz{color:red}">',
        { withShadow: false }
      );
      let $ = parseDOM(serializeDOM().html, 'plain');
      expect($('link[rel="stylesheet"]')[0].getAttribute('data-percy-element-id')).toBeNull();
      expect($('link[rel="preload"]')[0].getAttribute('data-percy-element-id')).toBeNull();
      expect($('link:not([rel])')[0].getAttribute('data-percy-element-id')).toBeNull();
    });

    it('does not accumulate <link>s when a head manager reconciles between snapshots', () => {
      withExample('<link rel="stylesheet" href="data:text/css,.lrec{color:red}">', { withShadow: false });
      let link = document.querySelector('link[rel="stylesheet"][href^="data:text/css,.lrec"]');
      let rendered = link.cloneNode();
      let reconcile = () => {
        if (!link.isEqualNode(rendered)) link.after(rendered.cloneNode());
      };

      serializeDOM();
      reconcile();
      let html = serializeDOM().html;

      expect(html.split('data:text/css,.lrec{').length - 1).toEqual(1);
    });

    it('still anchors a rewritten copy after its source <link>, not at end of head (PER-10077)', async () => {
      withExample(
        '<link rel="stylesheet" href="base/test/assets/hover-anchor.css">' +
        '<style>.lbtn.later { color: blue }</style>' +
        '<button class="lbtn later">go</button>',
        { withShadow: false }
      );
      let link = document.querySelector('link[href="base/test/assets/hover-anchor.css"]');
      await new Promise((resolve, reject) => {
        if (link.sheet) return resolve();
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', () => reject(new Error('hover-anchor.css failed to load')), { once: true });
      });

      let html = serializeDOM({ enablePseudoClassSerialization: true }).html;
      let sourceIdx = html.indexOf('hover-anchor.css');
      let copyIdx = html.indexOf('.lbtn[data-percy-hover]');
      let laterIdx = html.indexOf('.lbtn.later');
      expect(copyIdx).toBeGreaterThan(-1);
      expect(copyIdx).toBeGreaterThan(sourceIdx);
      expect(copyIdx).toBeLessThan(laterIdx);
    });
  });

  describe(':state() CSS rewriting', () => {
    it('rewrites :state() selectors to attribute selectors in shadow DOM styles', () => {
      if (getTestBrowser() !== chromeBrowser) return;

      withExample('', { withShadow: false });
      let el = document.createElement('div');
      let shadow = el.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>:host(:state(active)) { color: green; }</style><p>content</p>';
      document.getElementById('test').appendChild(el);

      let result = serializeDOM();
      expect(result.html).toContain('[data-percy-custom-state~="active"]');
      expect(result.html).not.toContain(':state(active)');
    });

    it('rewrites legacy :--state selectors', () => {
      if (getTestBrowser() !== chromeBrowser) return;

      withExample('', { withShadow: false });
      let el = document.createElement('div');
      let shadow = el.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>:host(:--loading) { opacity: 0.5; }</style><p>content</p>';
      document.getElementById('test').appendChild(el);

      let result = serializeDOM();
      expect(result.html).toContain('[data-percy-custom-state~="loading"]');
      expect(result.html).not.toContain(':--loading');
    });
  });

  describe('shadow-utils getRuntime fallback', () => {
    it('falls back to window when the node has no ownerDocument.defaultView', () => {
      // Exercises the `(typeof window !== 'undefined' ? window : null)` fallback
      // branch in shadow-utils.getRuntime — fires when getClosedShadowRoot is
      // called with a node that is null or has no resolvable runtime.
      // null-host calls return null/false without throwing — they hit the
      // fallback, then the optional chain on the missing WeakMap yields the
      // expected absent value.
      expect(getClosedShadowRoot(null)).toBeNull();
      expect(hasClosedShadowRoot(null)).toBe(false);
    });
  });
});
