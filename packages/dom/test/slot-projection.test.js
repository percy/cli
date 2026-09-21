import { withExample, parseDOM } from './helpers';
import serializeDOM from '@percy/dom';

// Mirrors the shape that surfaced PER-10812 in the wild — a Salesforce LWC
// "onboarding card" whose chrome lives in the shadow root and whose content and
// action button are slotted in by the caller:
//
//   <div id="card-layout">                    <- host
//     #shadow-root
//       <div class="card-container">
//         <div class="content-section"><slot></slot></div>
//         <div class="actions-section"><slot name="actions"></slot></div>
//     <div class="mainContent">Yes / No</div> <- renders in the default slot
//     <button slot="actions">Next</button>    <- renders in the named slot
//   </div>
function buildCard({ withActions = true, orphan = false } = {}) {
  withExample('<div id="content"></div>', { withShadow: false });
  const content = document.querySelector('#content');

  const host = document.createElement('div');
  host.id = 'card-layout';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<div class="card-container">',
    '<h3 class="headerText">Is Percy your student\'s preferred name?</h3>',
    '<div class="content-section"><slot></slot></div>',
    '<div class="actions-section"><slot name="actions"></slot></div>',
    '</div>'
  ].join('');

  const main = document.createElement('div');
  main.className = 'mainContent';
  main.textContent = 'Yes / No';
  host.appendChild(main);

  if (withActions) {
    const next = document.createElement('button');
    next.setAttribute('slot', 'actions');
    next.textContent = 'Next';
    host.appendChild(next);
  }

  if (orphan) {
    // assigned to a slot the component does not expose — the browser renders
    // nothing for it
    const stray = document.createElement('div');
    stray.className = 'strayContent';
    stray.setAttribute('slot', 'nonexistent');
    stray.textContent = 'never rendered';
    host.appendChild(stray);
  }

  content.appendChild(host);
  return host;
}

describe('serializeDOM - slot projection', () => {
  const isChrome = () => navigator.userAgent.toLowerCase().includes('chrome');

  describe('when the host is flattened by forceShadowAsLightDOM', () => {
    it('projects default-slot content into the slot position, not after the container', () => {
      if (!isChrome()) return;
      buildCard();

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);

      // the regression: content lands INSIDE the section holding the slot …
      const projected = $('#card-layout .card-container .content-section .mainContent');
      expect(projected.length).toEqual(1);
      expect(projected[0].textContent).toEqual('Yes / No');

      // … and NOT as a bare sibling after the card, which is what stranded the
      // "Yes / No" tiles outside their card in PER-10812
      expect($('#card-layout > .mainContent').length).toEqual(0);
    });

    it('routes named-slot content to its matching slot', () => {
      if (!isChrome()) return;
      buildCard();

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);

      const action = $('#card-layout .card-container .actions-section button');
      expect(action.length).toEqual(1);
      expect(action[0].textContent).toEqual('Next');

      // the named content must not leak into the default slot
      expect($('.content-section button').length).toEqual(0);
    });

    it('drops the inert <slot> elements themselves', () => {
      if (!isChrome()) return;
      buildCard();

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;

      expect(html).not.toMatch('<slot');
      expect(html).not.toMatch('<template shadowrootmode');
    });

    it('emits each slotted node exactly once', () => {
      if (!isChrome()) return;
      buildCard();

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;

      // the light-DOM walk must be skipped for a flattened host, or the
      // projected nodes get cloned a second time outside their container
      expect((html.match(/class="mainContent"/g) || []).length).toEqual(1);
      expect((html.match(/Yes \/ No/g) || []).length).toEqual(1);
    });

    it('drops a slotted noscript element', () => {
      if (!isChrome()) return;
      buildCard();
      const host = document.querySelector('#card-layout');
      const noscript = document.createElement('noscript');
      noscript.setAttribute('slot', 'actions');
      noscript.textContent = 'no js';
      host.appendChild(noscript);

      const html = serializeDOM({ forceShadowAsLightDOM: true }).html;

      expect(html).not.toMatch('<noscript');
      expect(html).not.toMatch('no js');
    });

    it('projects a slotted bare text node', () => {
      if (!isChrome()) return;
      withExample('<div id="content"></div>', { withShadow: false });
      const host = document.createElement('div');
      host.id = 'text-host';
      host.attachShadow({ mode: 'open' }).innerHTML = '<div class="wrap"><slot></slot></div>';
      host.appendChild(document.createTextNode('bare text'));
      document.querySelector('#content').appendChild(host);

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);

      expect($('#text-host .wrap')[0].textContent).toEqual('bare text');
    });

    it('does not throw for unprojected media elements in a flattened host', () => {
      if (!isChrome()) return;
      withExample('<div id="content"></div>', { withShadow: false });
      const host = document.createElement('div');
      host.id = 'noslot-host';
      // a shadow root with no <slot> at all renders none of its light children,
      // so they are not cloned and downstream serializers must skip them rather
      // than fail to resolve their clones
      host.attachShadow({ mode: 'open' }).innerHTML = '<div class="chrome">chrome</div>';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 10;
      const input = document.createElement('input');
      input.type = 'radio';
      host.append(canvas, input, document.createElement('video'), document.createElement('iframe'));
      document.querySelector('#content').appendChild(host);

      expect(() => serializeDOM({ forceShadowAsLightDOM: true })).not.toThrow();
    });

    it('drops content assigned to a slot the component does not expose', () => {
      if (!isChrome()) return;
      buildCard({ orphan: true });

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);

      // matches what the browser renders for an unmatched slot name: nothing
      expect($('.strayContent').length).toEqual(0);
    });

    it('preserves document order for several nodes in one slot', () => {
      if (!isChrome()) return;
      withExample('<div id="content"></div>', { withShadow: false });
      const host = document.createElement('div');
      host.id = 'multi';
      host.attachShadow({ mode: 'open' }).innerHTML = '<div class="wrap"><slot></slot></div>';

      for (const label of ['one', 'two', 'three']) {
        const item = document.createElement('p');
        item.textContent = label;
        host.appendChild(item);
      }
      document.querySelector('#content').appendChild(host);

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);
      const items = $('#multi .wrap p');

      expect(Array.from(items).map(p => p.textContent)).toEqual(['one', 'two', 'three']);
    });

    it('uses the slot fallback content when nothing is assigned', () => {
      if (!isChrome()) return;
      withExample('<div id="content"></div>', { withShadow: false });
      const host = document.createElement('div');
      host.id = 'fallback';
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<div class="wrap"><slot><span class="placeholder">Nothing here</span></slot></div>';
      document.querySelector('#content').appendChild(host);

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);
      const placeholder = $('#fallback .wrap .placeholder');

      expect(placeholder.length).toEqual(1);
      expect(placeholder[0].textContent).toEqual('Nothing here');
    });

    it('resolves slots forwarded through nested components', () => {
      if (!isChrome()) return;
      withExample('<div id="content"></div>', { withShadow: false });

      // <outer> forwards its own slotted content into <inner>'s slot, the
      // composition pattern the real portal nests four levels deep
      const inner = document.createElement('div');
      inner.className = 'inner-host';
      inner.attachShadow({ mode: 'open' }).innerHTML = '<div class="inner-wrap"><slot></slot></div>';

      const outer = document.createElement('div');
      outer.id = 'outer-host';
      const outerShadow = outer.attachShadow({ mode: 'open' });
      const outerWrap = document.createElement('div');
      outerWrap.className = 'outer-wrap';
      // the forwarding slot sits behind a wrapper, so it is not itself directly
      // assigned — assignedNodes({ flatten }) does not recurse into it and it
      // has to be resolved on its own when the walk reaches it
      const fwd = document.createElement('div');
      fwd.className = 'fwd';
      fwd.appendChild(document.createElement('slot'));
      inner.appendChild(fwd);
      outerWrap.appendChild(inner);
      outerShadow.appendChild(outerWrap);

      const payload = document.createElement('p');
      payload.className = 'payload';
      payload.textContent = 'forwarded';
      outer.appendChild(payload);

      document.querySelector('#content').appendChild(outer);

      const $ = parseDOM(serializeDOM({ forceShadowAsLightDOM: true }).html);
      const found = $('#outer-host .outer-wrap .inner-host .inner-wrap .fwd .payload');

      expect(found.length).toEqual(1);
      expect(found[0].textContent).toEqual('forwarded');
    });
  });

  describe('when the host keeps its shadow root', () => {
    it('leaves slots and slotted content untouched by default', () => {
      if (!isChrome()) return;
      buildCard();

      const html = serializeDOM().html;

      // a real shadow root serializes declaratively and the browser re-does the
      // projection at render time — nothing to resolve here
      expect(html).toMatch('<template shadowrootmode="open"');
      expect(html).toMatch('<slot></slot>');
      expect(html).toMatch('<slot name="actions"></slot>');
      expect(html).toMatch('class="mainContent"');
    });

    it('does not resolve slots when shadow DOM is disabled', () => {
      if (!isChrome()) return;
      buildCard();

      const $ = parseDOM(serializeDOM({ disableShadowDOM: true }).html);

      // the shadow root (and its slots) is dropped wholesale; light children
      // stay where they physically are
      expect($('#card-layout > .mainContent').length).toEqual(1);
      expect($('.card-container').length).toEqual(0);
    });
  });
});
