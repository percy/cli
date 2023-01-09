// create and cleanup testing DOM
export function withExample(html, shadow = true) {
  let $test = document.getElementById('test');
  if ($test) $test.remove();

  let $testShadow = document.getElementById('test-shadow');
  if ($testShadow) $testShadow.remove();

  $test = document.createElement('div');
  $test.id = 'test';
  $test.innerHTML = `<h1>Hello DOM testing</h1>${html}`;

  document.body.appendChild($test);

  if (shadow) {
    $testShadow = document.createElement('div');
    $testShadow.id = 'test-shadow';
    let $shadow = $testShadow.attachShadow({ mode: 'open' });
    $shadow.innerHTML = `<h1>Hello DOM testing</h1>${html}`;

    document.body.appendChild($testShadow);
  }
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
    $style.sheet.insertRule(rule);
  }

  withShadowCSSOM(rules, prepare);
}

export function withShadowCSSOM(rules = [], prepare = () => {}) {
  let $test = document.getElementById('test-shadow').shadowRoot;
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
export function parseDOM(domstring, platform) {
  if (platform === 'shadow') {
    return parseDeclShadowDOM(domstring);
  }
  if (domstring.html) domstring = domstring.html;
  let dom = new window.DOMParser().parseFromString(domstring, 'text/html');
  return selector => dom.querySelectorAll(selector);
}

export function parseDeclShadowDOM(domstring) {
  if (domstring.html) domstring = domstring.html;
  let dom = new window.DOMParser().parseFromString(domstring, 'text/html');
  let root = dom.getElementById('test-shadow');

  return selector => root.firstChild.content.querySelectorAll(selector);
}

// generic assert
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
