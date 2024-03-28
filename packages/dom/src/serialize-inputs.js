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
          so that only the current selected radio-button will have the checked attr present in the dom

          this happens because in html, when the checked attribute is present in the multiple radio-buttons by default,
          the browser will only render the last checked radio-button as when the user is selecting any particular button,
          the checked attribute on other buttons is not removed,
          hence sometimes it shows inconsistent state even though the `element.checked` attribute returns correct state
        */
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
