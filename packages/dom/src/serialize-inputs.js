// Translates JavaScript properties of inputs into DOM attributes.
export function serializeInputElements({ dom, clone, warnings }) {
  for (let elem of dom.querySelectorAll('input, textarea, select')) {
    let inputId = elem.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${inputId}"]`);

    switch (elem.type) {
      case 'checkbox':
      case 'radio':
        elem.removeAttribute('checked');
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
