import { handleErrors } from './utils';

// Serializes open <dialog> elements opened via showModal().
//
// When the renderer re-renders the serialized HTML, it runs
// dialog-element-helper.js which calls close() then showModal()
// to restore ::backdrop. However, close() fires a 'close' event
// that frameworks (React, etc.) may listen to, destroying the
// dialog DOM. We mark the dialog with data-percy-dialog-modal
// so the renderer can skip the close/showModal cycle.
//
// The renderer then handles ::backdrop natively via showModal().
// We only need to handle positioning (top-layer simulation) and
// move the dialog to <body> to escape parent stacking contexts.
export function serializeDialogs(ctx) {
  let { dom, clone } = ctx;
  let cssRules = [];

  for (let elem of dom.querySelectorAll('dialog[open]')) {
    try {
      let dialogId = elem.getAttribute('data-percy-element-id');
      if (!dialogId) continue;

      let cloneEl = clone.querySelector(`[data-percy-element-id="${dialogId}"]`);
      if (!cloneEl) continue;

      if (!cloneEl.hasAttribute('open')) {
        cloneEl.setAttribute('open', '');
      }

      // Detect if dialog was opened via showModal() by checking
      // if ::backdrop has non-default styles
      let isModal = false;
      try {
        let backdropStyles = window.getComputedStyle(elem, '::backdrop');
        if (backdropStyles) {
          let bg = backdropStyles.getPropertyValue('background-color') ||
                   backdropStyles.getPropertyValue('background');
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            isModal = true;
          }
          let filter = backdropStyles.getPropertyValue('backdrop-filter') ||
                       backdropStyles.getPropertyValue('-webkit-backdrop-filter');
          if (filter && filter !== 'none') {
            isModal = true;
          }
        }
      } catch (_) { /* not a modal */ }

      if (!isModal) continue;

      let cloneBody = clone.body || clone.querySelector('body');
      if (!cloneBody) continue;

      // Mark dialog so the renderer skips the close/showModal cycle
      // and caps screenshot height to viewport
      cloneEl.setAttribute('data-percy-dialog-modal', 'true');

      // Move dialog to end of body to escape parent stacking contexts
      cloneBody.appendChild(cloneEl);

      // Dialog positioning to simulate top-layer behavior
      cssRules.push(`[data-percy-element-id="${dialogId}"][data-percy-dialog-modal] {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        z-index: 2147483647 !important;
        margin: 0 !important;
        max-height: 90vh !important;
        max-width: 90vw !important;
        overflow: auto !important;
      }`);
    } catch (err) {
      handleErrors(err, 'Error serializing dialog element: ', elem);
    }
  }

  // Inject CSS rules via a single <style> tag
  if (cssRules.length > 0) {
    let styleElement = dom.createElement('style');
    styleElement.setAttribute('data-percy-dialog-styles', 'true');
    styleElement.textContent = cssRules.join('\n');

    let head = clone.head || clone.querySelector('head');
    if (head) {
      head.appendChild(styleElement);
    }
  }
}

export default serializeDialogs;
