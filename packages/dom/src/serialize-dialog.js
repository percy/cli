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

      // Detect showModal() vs show()/setAttribute:
      // :modal pseudo-class matches only dialogs in the top layer (opened via showModal())
      if (!elem.matches(':modal')) continue;

      // Mark for renderer - it will removeAttribute('open') then showModal()
      cloneEl.setAttribute('data-percy-dialog-modal', 'true');
    } catch (err) {
      handleErrors(err, 'Error serializing dialog element: ', elem);
    }
  }
}

export default serializeDialogs;
