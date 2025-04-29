
export const chromeBrowser = 'CHROME';
export const firefoxBrowser = 'FIREFOX';

// create and cleanup testing DOM
export function withExample(html, options = { withShadow: true, withRestrictedShadow: false, invalidTagsOutsideBody: false, withoutBody: false }) {
  let $test = document.getElementById('test');
  if ($test) $test.remove();

  let $testShadow = document.getElementById('test-shadow');
  if ($testShadow) $testShadow.remove();

  if (options.withoutBody) {
    // Create a DOM structure without a <body> tag
    const $html = document.documentElement;
    $html.innerHTML = `<title>Test</title>${html}`;
  } else {
    $test = document.createElement('div');
    $test.id = 'test';
    $test.innerHTML = `<h1>Hello DOM testing</h1>${html}`;
    document.body.appendChild($test);
  }

  if (options.withShadow) {
    $testShadow = document.createElement('div');
    $testShadow.id = 'test-shadow';
    let $shadow = $testShadow.attachShadow({ mode: 'open' });
    $shadow.innerHTML = `<h1>Hello DOM testing</h1>${html}`;

    document.body.appendChild($testShadow);
  }

  if (options.withRestrictedShadow) {
    $testShadow = document.createElement('div');
    $testShadow.id = 'test-shadow';
    let $shadow = $testShadow.attachShadow({ mode: 'open' });
    Object.defineProperty($shadow, 'styleSheets', {
      get: function() {
        throw new Error();
      }
    });
    $shadow.innerHTML = `<h1>Hello DOM testing</h1>${html}`;

    document.body.appendChild($testShadow);
  }

  if (options.invalidTagsOutsideBody) {
    let p = document.getElementById('invalid-p');
    p?.remove();
    p = document.createElement('p');
    p.id = 'invalid-p';
    p.innerText = 'P tag outside body';
    document.documentElement.append(p);
  }
  document.cookie = 'test-cokkie=test-value';
  return document;
}

// create a stylesheet in the DOM and add rules using the CSSOM
export function withCSSOM(rules = [], prepare = () => {}, options = { withShadow: true }) {
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

  if (options?.withShadow) {
    let $testShadow = document.getElementById('test-shadow').shadowRoot;
    let $shadowStyle = $testShadow.getElementById('test-style');
    if ($shadowStyle) $shadowStyle.remove();

    $shadowStyle = document.createElement('style');
    $shadowStyle.id = 'test-style';
    $shadowStyle.type = 'text/css';
    prepare?.($shadowStyle);
    $testShadow.prepend($shadowStyle);

    for (let rule of [].concat(rules)) {
      $shadowStyle.sheet.insertRule(rule);
    }
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

export function createShadowEl(tag = 0) {
  const contentEl = document.createElement('div');
  contentEl.id = `Percy-${tag}`;
  const shadow = contentEl.attachShadow({ mode: 'open' });
  const paragraphEl = document.createElement('p');
  paragraphEl.textContent = `Percy-${tag}`;
  shadow.appendChild(paragraphEl);
  return contentEl;
}

export function getTestBrowser() {
  if (navigator.userAgent.toLowerCase().includes('chrome')) {
    return chromeBrowser;
  } else if (navigator.userAgent.toLowerCase().includes('firefox')) {
    return firefoxBrowser;
  } else {
    throw new Error('unsupported test browser');
  }
}

export const platforms = (() => {
  if (getTestBrowser() === chromeBrowser) {
    return ['plain', 'shadow'];
  }
  return ['plain'];
})();

export function platformDOM(plat) {
  if (plat === 'shadow') {
    return document.getElementById('test-shadow')?.shadowRoot;
  }
  return document;
}

// generic assert
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function createAndAttachSlotTemplate(baseElement) {
  baseElement.innerHTML = `
  <custom-element>
      <p slot="title">Hello from the title slot!</p>
      <p>This content is distributed into the default slot.</p>
    </custom-element>
  `;
  class CustomElement extends window.HTMLElement {
    constructor() {
      super();

      // Attach shdow DOM
      const shadowRoot = this.attachShadow({ mode: 'open' });

      // Add template content to shadow DOM
      shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            background-color: #f9f9f9;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
            padding: 15px;
            font-family: Arial, sans-serif;
          }
          ::slotted([slot="title"]) {
            font-size: 1.5em;
            font-weight: bold;
            color: #333;
          }
          ::slotted(*) {
            margin: 5px 0;
          }
        </style>
        <div>
          <slot name="title"></slot>
          <slot></slot>
        </div>
      `;
    }
  }

  // Register the custom element

  window.customElements.define('custom-element', CustomElement);
}
