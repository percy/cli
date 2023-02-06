import { withExample, replaceDoctype, createShadowEl, getTestBrowser, chromeBrowser } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeDOM', () => {
  it('returns serialied html, warnings, and resources', () => {
    expect(serializeDOM()).toEqual({
      html: jasmine.any(String),
      warnings: jasmine.any(Array),
      resources: jasmine.any(Array)
    });
  });

  it('optionally returns a stringified response', () => {
    expect(serializeDOM({ stringifyResponse: true }))
      .toMatch('{"html":".*","warnings":\\[\\],"resources":\\[\\]}');
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
      expect(html).toMatch('<template shadowroot="open">');
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

    it('renders single nested ', () => {
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
        '<template shadowroot="open">',
        '<p>Percy-1</p>',
        '<div id="Percy-2" .*>',
        '<template shadowroot="open">',
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
          '<template shadowroot="open">',
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
          '<template shadowroot="open">',
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
          const shadow = this.shadowRoot || this.attachShadow({ mode: 'open' });
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

    it('logs any errors and returns the serialized DOM', () => {
      let { html } = serializeDOM({
        domTransformation(dom) {
          throw new Error('test error');
          // eslint-disable-next-line no-unreachable
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(html).toMatch('Delete me');
      expect(console.error)
        .toHaveBeenCalledOnceWith('Could not transform the dom:', 'test error');
    });
  });
});
