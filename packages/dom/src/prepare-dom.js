// Returns a mostly random uid.
function uid() {
  return `_${Math.random().toString(36).substr(2, 9)}`;
}

// Marks elements that are to be serialized later with a data attribute.
export default function prepareDOM(dom) {
  for (let elem of dom.querySelectorAll('input, textarea, select, iframe, canvas')) {
    if (!elem.getAttribute('data-percy-element-id')) {
      elem.setAttribute('data-percy-element-id', uid());
    }
  }
}
