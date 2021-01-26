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
  let dom = new window.DOMParser().parseFromString(domstring, 'text/html');
  return selector => dom.querySelectorAll(selector);
}

// generic assert
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// simple bdd expect function to mimic node expect library
export function expect(received) {
  let negated = false;

  let assert = (condition, message) => {
    if (negated ? condition : !condition) throw new Error(message);
  };

  let format = (expectation, received) => (
    `Expected ${negated ? 'not ' : ''}${expectation}, recieved ${JSON.stringify(received)}`
  );

  return {
    get not() {
      negated = true;
      return this;
    },

    toBe(expected) {
      assert(
        Object.is(received, expected),
        format(JSON.stringify(expected), received)
      );
    },

    toEqual(expected) {
      if (typeof expected === 'object') {
        for (let i in expected) expect(received[i]).toEqual(expected[i]);
      } else {
        assert(received === expected, format(`.toEqual(${expected})`, received));
      }
    },

    toHaveLength(length) {
      assert(
        received.length === length,
        format(`.toHaveLength(${length})`, received.length)
      );
    },

    toBeDefined() {
      assert(
        received != null,
        format('.toBeDefined', received)
      );
    },

    toBeUndefined() {
      assert(
        received == null,
        format('.toBeUndefined', received)
      );
    },

    toBeNull() {
      assert(
        received === null,
        format('.toBeNull', received)
      );
    },

    toHaveProperty(property, value) {
      assert(
        property.split('.').reduce((val, key) => val?.[key], received) === value,
        format(`.toHaveProperty(${property}, ${value})`, received)
      );
    },

    toMatch(pattern) {
      if (typeof pattern === 'string') {
        pattern = new RegExp(pattern);
      }

      assert(
        pattern.test(received),
        format(`.toMatch(${pattern})`, received)
      );
    }
  };
}
