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

export function withShadowExample(html) {
  let $test = document.getElementById('test');
  if ($test) $test.remove();

  $test = document.createElement('div');
  $test.id = 'test';
  let $shadow = $test.attachShadow({ mode: 'open' })
  $shadow.innerHTML = `<h1>Hello DOM testing</h1>${html}`;

  document.body.appendChild($test);
  return document;
}

export function getExampleShadowRoot() {
  let $test = document.getElementById('test');
  if (!$test) return null;

  return $test.shadowRoot;
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
    $style.sheet.insertRule(rule);
  }
}

export function withShadowCSSOM(rules = [], prepare = () => {}) {
  let $test = getExampleShadowRoot();
  let $style = $test.getElementById('test-style');
  if ($style) $style.remove();

  $style = document.createElement('style');
  $style.id = 'test-style';
  $style.type = 'text/css';
  prepare?.($style);
  $test.prepend($style);

  for (let rule of [].concat(rules)) {
    $style.sheet.insertRule(rule);
  }
}

// replaces the current document's doctype
export function replaceDoctype(name, publicId = '', systemId = '') {
  let doctype = document.implementation.createDocumentType(name, publicId, systemId);

  if (document.doctype) {
    document.replaceChild(doctype, document.doctype);
  } else {
    document.insertBefore(doctype, document.childNodes[0]);
  }
}

// parses a DOM string into a DOM object and returns a querySelectorAll shortcut
export function parseDOM(domstring) {
  if (domstring.html) domstring = domstring.html;
  let dom = new window.DOMParser().parseFromString(domstring, 'text/html');
  return selector => dom.querySelectorAll(selector);
}

export function parseDeclShadowDOM(domstring) {
  if (domstring.html) domstring = domstring.html;
  let dom = new window.DOMParser().parseFromString(domstring, 'text/html');
  let root = dom.getElementById('test')

  return selector => root.firstChild.content.querySelectorAll(selector);
}

export const isShadowMode = !!window.__karma__.config.shadow;

// generic assert
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
