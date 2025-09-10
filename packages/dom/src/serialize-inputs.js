import { handleErrors } from './utils';

// Translates JavaScript properties of inputs into DOM attributes.
export function serializeInputElements(ctx) {
  let { dom, clone } = ctx;
  for (let elem of dom.querySelectorAll('input, textarea, select')) {
    try {
      let inputId = elem.getAttribute('data-percy-element-id');
      let cloneEl = clone.querySelector(`[data-percy-element-id="${inputId}"]`);

      switch (elem.type) {
        case 'checkbox':
        case 'radio':
          /*
            here we are removing the checked attr if present by default,
            so that only the current selected radio-button will have the checked attr present in the dom
            this happens because in html,
            when the checked attribute is present in the multiple radio-buttons for which only one can be selected at a time,
            the browser will only render the last checked radio-button by default,
            when a user selects any particular radio-button, the checked attribute on other buttons is not removed,
            hence sometimes it shows inconsistent state as html will still show the last radio as selected.
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
          cloneEl.textContent = elem.value || '';
          break;
        default:
          cloneEl.setAttribute('value', elem.value);
      }
    } catch (err) {
      handleErrors(err, 'Error serializing input element: ', elem);
    }
  }
}

export default serializeInputElements;
