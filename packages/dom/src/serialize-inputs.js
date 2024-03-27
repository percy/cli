// Translates JavaScript properties of inputs into DOM attributes.
export function serializeInputElements({ dom, clone, warnings }) {
  for (let elem of dom.querySelectorAll('input, textarea, select')) {
    let inputId = elem.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${inputId}"]`);

    switch (elem.type) {
      case 'checkbox':
      case 'radio':
        /*
          here we are removing the checked attr if present by default,
          so that only the selected radio-button will have the checked attr present in the dom

          we need to removed `checked` from both cloneEl & elem as if it is only removed from cloneEl,
          then if any radio-button has `checked` attr present by default,
          then it will be shown as checked even though it was not explicitly selected before taking snapshot
        */
        elem.removeAttribute('checked');
        cloneEl.removeAttribute('checked');
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
}

export default serializeInputElements;
