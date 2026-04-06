import { handleErrors } from './utils';

// Serializes open <dialog> elements opened via showModal().
//
// The browser's ::backdrop and top-layer positioning are lost during
// DOM serialization. We stamp data-percy-dialog-modal so the renderer
// can call removeAttribute('open') then showModal() to restore them.
//
// The open attribute is kept so the dialog is visible during Percy's
// asset discovery and rendering phases.
export function serializeDialogs(ctx) {
  let { dom, clone } = ctx;

  for (let elem of dom.querySelectorAll('dialog[open]')) {
    try {
      let dialogId = elem.getAttribute('data-percy-element-id');
      if (!dialogId) continue;

      let cloneEl = clone.querySelector(`[data-percy-element-id="${dialogId}"]`);
      if (!cloneEl) continue;

      if (!cloneEl.hasAttribute('open')) {
        cloneEl.setAttribute('open', '');
      }

      // Detect showModal() vs show():
      // showModal() sets position:fixed (top layer). show() is position:absolute.
      let dialogPosition = window.getComputedStyle(elem).getPropertyValue('position');
      if (dialogPosition !== 'fixed') continue;

      // Mark for renderer — it will removeAttribute('open') then showModal()
      cloneEl.setAttribute('data-percy-dialog-modal', 'true');
      // Pass original viewport height so renderer caps screenshot to viewport
      cloneEl.setAttribute('data-percy-dialog-viewport-height', String(window.innerHeight));
    } catch (err) {
      handleErrors(err, 'Error serializing dialog element: ', elem);
    }
  }
}

export default serializeDialogs;
