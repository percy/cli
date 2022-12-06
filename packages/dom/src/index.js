if (!Element.prototype.getInnerHTML) {
  function explore(element, opts = {}) {
    const children = element.shadowRoot ? element.shadowRoot.children : element.children;
    if (children.length === 0)
      return element.outerHTML

    let contents = ""
    for (const child of children) {
      contents += explore(child)
    }

    let [openTag, closeTag] = element.cloneNode().outerHTML.split(/\>\</)

    if (element.shadowRoot) {
      openTag += "><template shadowroot=\"open\">"
      closeTag = "</template><" + closeTag
    } else {
      openTag += ">"
      closeTag = "<" + closeTag
    }
    return openTag + contents + closeTag
  };

  Element.prototype.getInnerHTML = function() {
    let content = ""
    for (const child of this.children)
      content = explore(child)
    return content
  }
}

export {
  default,
  serializeDOM,
  // namespace alias
  serializeDOM as serialize
} from './serialize-dom';
