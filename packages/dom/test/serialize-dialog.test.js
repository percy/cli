import { withExample, parseDOM, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeDialogs', () => {
  let cache = { shadow: {}, plain: {} };

  describe('dialog opened via showModal()', () => {
    beforeEach(() => {
      withExample(`
        <dialog id="modal-dialog">
          <p>Modal dialog content</p>
        </dialog>
      `);

      platforms.forEach((platform) => {
        const dom = platformDOM(platform);
        const dialog = dom.querySelector('#modal-dialog');
        // Open via showModal() to put it in the top layer
        dialog.showModal();
        cache[platform].$ = parseDOM(serializeDOM(), platform);
      });
    });

    platforms.forEach((platform) => {
      it(`should stamp data-percy-dialog-modal on showModal() dialog [${platform}]`, () => {
        const $ = cache[platform].$;
        const dialogs = $('dialog#modal-dialog');
        expect(dialogs.length).toBe(1);
        expect(dialogs[0].getAttribute('data-percy-dialog-modal')).toBe('true');
        expect(dialogs[0].hasAttribute('open')).toBe(true);
      });
    });
  });

  describe('dialog opened via setAttribute', () => {
    beforeEach(() => {
      withExample(`
        <dialog id="attr-dialog">
          <p>Attribute dialog content</p>
        </dialog>
      `);

      platforms.forEach((platform) => {
        const dom = platformDOM(platform);
        const dialog = dom.querySelector('#attr-dialog');
        // Open via setAttribute - NOT showModal()
        dialog.setAttribute('open', '');
        cache[platform].$ = parseDOM(serializeDOM(), platform);
      });
    });

    platforms.forEach((platform) => {
      it(`should NOT stamp data-percy-dialog-modal on setAttribute dialog [${platform}]`, () => {
        const $ = cache[platform].$;
        const dialogs = $('dialog#attr-dialog');
        expect(dialogs.length).toBe(1);
        expect(dialogs[0].hasAttribute('data-percy-dialog-modal')).toBe(false);
        expect(dialogs[0].hasAttribute('open')).toBe(true);
      });
    });
  });

  describe('dialog opened via show()', () => {
    beforeEach(() => {
      withExample(`
        <dialog id="show-dialog">
          <p>Show dialog content</p>
        </dialog>
      `);

      platforms.forEach((platform) => {
        const dom = platformDOM(platform);
        const dialog = dom.querySelector('#show-dialog');
        // Open via show() - NOT showModal()
        dialog.show();
        cache[platform].$ = parseDOM(serializeDOM(), platform);
      });
    });

    platforms.forEach((platform) => {
      it(`should NOT stamp data-percy-dialog-modal on show() dialog [${platform}]`, () => {
        const $ = cache[platform].$;
        const dialogs = $('dialog#show-dialog');
        expect(dialogs.length).toBe(1);
        expect(dialogs[0].hasAttribute('data-percy-dialog-modal')).toBe(false);
        expect(dialogs[0].hasAttribute('open')).toBe(true);
      });
    });
  });

  describe('closed dialog', () => {
    beforeEach(() => {
      withExample(`
        <dialog id="closed-dialog">
          <p>Closed dialog content</p>
        </dialog>
      `);

      platforms.forEach((platform) => {
        cache[platform].$ = parseDOM(serializeDOM(), platform);
      });
    });

    platforms.forEach((platform) => {
      it(`should NOT stamp data-percy-dialog-modal on closed dialog [${platform}]`, () => {
        const $ = cache[platform].$;
        const dialogs = $('dialog#closed-dialog');
        expect(dialogs.length).toBe(1);
        expect(dialogs[0].hasAttribute('data-percy-dialog-modal')).toBe(false);
        expect(dialogs[0].hasAttribute('open')).toBe(false);
      });
    });
  });

  describe('multiple dialogs with mixed open methods', () => {
    beforeEach(() => {
      withExample(`
        <dialog id="dialog-modal">
          <p>Modal dialog</p>
        </dialog>
        <dialog id="dialog-attr">
          <p>Attribute dialog</p>
        </dialog>
        <dialog id="dialog-closed">
          <p>Closed dialog</p>
        </dialog>
      `);

      platforms.forEach((platform) => {
        const dom = platformDOM(platform);
        dom.querySelector('#dialog-modal').showModal();
        dom.querySelector('#dialog-attr').setAttribute('open', '');
        cache[platform].$ = parseDOM(serializeDOM(), platform);
      });
    });

    platforms.forEach((platform) => {
      it(`should only stamp the showModal() dialog [${platform}]`, () => {
        const $ = cache[platform].$;

        const modal = $('dialog#dialog-modal');
        expect(modal[0].getAttribute('data-percy-dialog-modal')).toBe('true');
        expect(modal[0].hasAttribute('open')).toBe(true);

        const attr = $('dialog#dialog-attr');
        expect(attr[0].hasAttribute('data-percy-dialog-modal')).toBe(false);
        expect(attr[0].hasAttribute('open')).toBe(true);

        const closed = $('dialog#dialog-closed');
        expect(closed[0].hasAttribute('data-percy-dialog-modal')).toBe(false);
        expect(closed[0].hasAttribute('open')).toBe(false);
      });
    });
  });
});
