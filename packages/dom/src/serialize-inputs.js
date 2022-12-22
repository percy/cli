// Translates JavaScript properties of inputs into DOM attributes.
export function serializeInputElements({ dom, clone }) {
  for (let elem of dom.querySelectorAll('input, textarea, select')) {
    let inputId = elem.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${inputId}"]`);

    switch (elem.type) {
      case 'checkbox':
      case 'radio':
        if (elem.checked) {
          cloneEl.setAttribute('checked', '');
        }
        break;
      case 'select-one':
        if (elem.selectedIndex !== -1) {
          cloneEl.options[elem.selectedIndex].setAttribute('selected', 'true');
        }
        break;
      case 'select-multiple':
        for (let option of elem.selectedOptions) {
          cloneEl.options[option.index].setAttribute('selected', 'true');
        }
        break;
      case 'textarea':
        cloneEl.innerHTML = elem.value;
        break;
      default:
        cloneEl.setAttribute('value', elem.value);
    }
  }

  // find inputs inside shadow host and recursively serialize them.
  for (let shadowHost of dom.querySelectorAll('[data-percy-shadow-host]')) {
    let percyElementId = shadowHost.getAttribute('data-percy-element-id');
    let cloneShadowHost = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);

    if (shadowHost.shadowRoot && cloneShadowHost.shadowRoot) {
      serializeInputElements({
        dom: shadowHost.shadowRoot,
        clone: cloneShadowHost.shadowRoot
      });
    }
  }
}

export default serializeInputElements;
