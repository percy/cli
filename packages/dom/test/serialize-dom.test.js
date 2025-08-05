import { withExample, replaceDoctype, createShadowEl, getTestBrowser, chromeBrowser, parseDOM, createAndAttachSlotTemplate } from './helpers';
import serializeDOM, { waitForResize } from '@percy/dom';

describe('serializeDOM', () => {
  it('returns serialied html, warnings, and resources', () => {
    expect(serializeDOM()).toEqual({
      html: jasmine.any(String),
      cookies: jasmine.any(String),
      userAgent: jasmine.any(String),
      warnings: jasmine.any(Array),
      resources: jasmine.any(Array),
      hints: jasmine.any(Array),
      perfInfo: jasmine.any(Object)
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
      .toMatch('{"html":".*","cookies":".*","userAgent":".*","warnings":\\[\\],"resources":\\[\\],"hints":\\[\\], "perfInfo":{.*}}');
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
      expect(serialized.warnings).toEqual(['data-percy-shadow-host does not have shadowRoot']);
    });

    it('renders slot template with shadowrootmode open', () => {
      withExample('<div id="content"></div>', { withShadow: false });
      const baseContent = document.querySelector('#content');
      createAndAttachSlotTemplate(baseContent);

      const html = serializeDOM().html;
      expect(html).toMatch('<template shadowrootmode="open">');
      expect(html).toMatch('<p slot="title">Hello from the title slot!</p>');
      expect(html).toMatch('<p>This content is distributed into the default slot.</p>');

      // match style pattern regex
      const stylePattern = [
        '<style data-percy-element-id=".*">',
        ':host\\s*{[^}]*}',
        '::slotted\\(\\[slot="title"\\]\\)\\s*{[^}]*}',
        '::slotted\\(\\*\\)\\s*{[^}]*}'
      ].join('\\s*');
      expect(html).toMatch(new RegExp(stylePattern));
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
});
