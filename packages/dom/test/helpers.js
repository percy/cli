// create and cleanup testing DOM
export function withExample(html) {
  let $test = document.getElementById('test');
  if ($test) $test.remove();

  $test = document.createElement('div');
  $test.id = 'test';
  $test.innerHTML = `<h1>Hello DOM testing</h1>${html}`;

  document.body.appendChild($test);
  return document;
}

// create a stylesheet in the DOM and add rules using the CSSOM
export function withCSSOM(rules = [], prepare = () => {}) {
  let $test = document.getElementById('test');
  let $style = document.getElementById('test-style');
  if ($style) $style.remove();

  $style = document.createElement('style');
  $style.id = 'test-style';
  $style.type = 'text/css';
  prepare?.($style);
  $test.prepend($style);

  for (let rule of [].concat(rules)) {
    document.styleSheets[0].insertRule(rule);
  }
}

export function replaceDoctype(name, publicId = '', systemId = '') {
  let doctype = document.implementation.createDocumentType(name, publicId, systemId);

  if (document.doctype) {
    document.replaceChild(doctype, document.doctype);
  } else {
    document.insertBefore(doctype, document.childNodes[0]);
  }
}
