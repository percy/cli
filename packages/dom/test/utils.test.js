import { handleErrors, resourceFromDataURL, resourceFromText, rewriteLocalhostURL, styleSheetFromNode } from '../src/utils';
describe('utils', () => {
  describe('handleErrors', () => {
    it('enriches the message in place on a plain Error', () => {
      let original = new Error('boom');

      expect(() => handleErrors(original, 'Error serializing thing: '))
        .toThrowMatching(err => err === original &&
          err.message.startsWith('boom') &&
          err.message.includes('Error serializing thing:') &&
          err.handled === true);
    });

    it('includes element data when an element is passed', () => {
      let el = document.createElement('canvas');
      el.className = 'chart';
      el.id = 'sales';

      expect(() => handleErrors(new Error('boom'), 'Error serializing canvas element: ', el))
        .toThrowMatching(err => err.message.includes('"nodeName":"CANVAS"') &&
          err.message.includes('"classNames":"chart"') &&
          err.message.includes('"id":"sales"'));
    });

    // DOMException declares `message` as a getter-only accessor, so assigning to it
    // in this strict-mode bundle throws a TypeError that masks the real error and
    // fails the entire snapshot. Regression test for PER-10368.
    it('does not throw a TypeError when the error message is getter-only', () => {
      let original = new window.DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError');

      expect(() => handleErrors(original, 'Error serializing canvas element: '))
        .toThrowMatching(err => !(err instanceof TypeError) &&
          !err.message.includes('which has only a getter'));
    });

    it('preserves the original message, name, and cause when message is getter-only', () => {
      let original = new window.DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError');

      expect(() => handleErrors(original, 'Error serializing canvas element: '))
        .toThrowMatching(err => err !== original &&
          err.name === 'SecurityError' &&
          err.cause === original &&
          err.handled === true &&
          err.message.startsWith('The canvas has been tainted by cross-origin data.') &&
          err.message.includes('Error serializing canvas element:') &&
          err.message.includes('W3C standards'));
    });

    it('handles a frozen error without throwing a TypeError', () => {
      let original = Object.freeze(new Error('frozen boom'));

      expect(() => handleErrors(original, 'Error cloning node: '))
        .toThrowMatching(err => !(err instanceof TypeError) &&
          err.message.startsWith('frozen boom') &&
          err.handled === true);
    });
  });

  describe('styleSheetFromNode', () => {
    it('creates stylesheet properly', () => {
      const node = document.createElement('style');
      node.innerText = 'p { background-color: red }';
      const cloneSpy = spyOn(node, 'cloneNode').and.callThrough();
      const sheet = styleSheetFromNode(node);
      expect(sheet.cssRules[0].cssText).toEqual('p { background-color: red; }');
      // nonce needs to be copied
      expect(cloneSpy).toHaveBeenCalled();
    });

    it('throws and triggers error handling when passed an invalid node', () => {
      expect(() => styleSheetFromNode(null)).toThrowMatching((err) => {
        return err.message && err.message.includes('Failed to get stylesheet from node:');
      });
    });

    it('returns falsy for non-style nodes', () => {
      const node = document.createElement('div');
      node.innerText = 'p { color: blue }';
      const sheet = styleSheetFromNode(node);
      expect(sheet).toBeFalsy();
    });

    it('returns the node.sheet when stylesheet is already available', () => {
      const node = document.createElement('style');
      node.innerText = 'p { color: green }';
      // attach to document so node.sheet is populated
      document.head.appendChild(node);
      const cloneSpy = spyOn(node, 'cloneNode').and.callThrough();
      const sheet = styleSheetFromNode(node);
      expect(sheet).toBe(node.sheet);
      expect(cloneSpy).not.toHaveBeenCalled();
      document.head.removeChild(node);
    });

    it('throws and triggers error handling for invalid node', () => {
      const text = document.createTextNode('just text');
      expect(() => styleSheetFromNode(text)).toThrowMatching((err) => {
        return err.message && err.message.includes('Failed to get stylesheet from node:');
      });
    });
  });

  describe('resourceFromDataURL', () => {
    const uid = (Math.random() + 1).toString(36).substring(10);
    const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+';
    it('If URL is localhost, replace it to render.percy.local', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://localhost'
      });
      const result = resourceFromDataURL(uid, dataURL);
      expect(result).toEqual({
        url: `http://render.percy.local/__serialized__/${uid}.png`,
        content: 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+',
        mimetype: 'image/png'
      });
    });
    it('If URL is 127.0.0.1, replace it to render.percy.local', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://127.0.0.1'
      });
      const result = resourceFromDataURL(uid, dataURL);
      expect(result).toEqual({
        url: `http://render.percy.local/__serialized__/${uid}.png`,
        content: 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+',
        mimetype: 'image/png'
      });
    });
    it('If URL is not localhost, return as is', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://example.com'
      });
      const result = resourceFromDataURL(uid, dataURL);
      expect(result).toEqual({
        url: `http://example.com/__serialized__/${uid}.png`,
        content: 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+',
        mimetype: 'image/png'
      });
    });
  });
  describe('resourceFromText', () => {
    const uid = (Math.random() + 1).toString(36).substring(10);
    const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+';
    it('Replace localhost to render.percy.local', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://localhost'
      });
      const result = resourceFromText(uid, 'image/png', dataURL);
      expect(result).toEqual({
        url: `http://render.percy.local/__serialized__/${uid}.png`,
        content: dataURL,
        mimetype: 'image/png'
      });
    });
    it('Replace 127.0.0.1 to render.percy.local', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://127.0.0.1'
      });
      const result = resourceFromText(uid, 'image/png', dataURL);
      expect(result).toEqual({
        url: `http://render.percy.local/__serialized__/${uid}.png`,
        content: dataURL,
        mimetype: 'image/png'
      });
    });
    it('If URL is not localhost, return as is', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://example.com'
      });
      const result = resourceFromText(uid, 'image/png', dataURL);
      expect(result).toEqual({
        url: `http://example.com/__serialized__/${uid}.png`,
        content: dataURL,
        mimetype: 'image/png'
      });
    });
  });
  describe('rewriteLocalhostURL', () => {
    it('should replace with render.percy.local', () => {
      const case1 = rewriteLocalhostURL('https://localhost/hello');
      expect(case1).toEqual('https://render.percy.local/hello');
      const case2 = rewriteLocalhostURL('http://localhost:4000/hello');
      expect(case2).toEqual('http://render.percy.local/hello');
      const case3 = rewriteLocalhostURL('http://localhost/hello');
      expect(case3).toEqual('http://render.percy.local/hello');
      const case4 = rewriteLocalhostURL('https://localhost:4000/hello');
      expect(case4).toEqual('https://render.percy.local/hello');
    });
    it('Should not replace url', () => {
      const case1 = rewriteLocalhostURL('http://hello.com/localhost/');
      expect(case1).toEqual('http://hello.com/localhost/');
      const case2 = rewriteLocalhostURL('http://hello/world');
      expect(case2).toEqual('http://hello/world');
      const case3 = rewriteLocalhostURL('http://hellolocalhost:2000/world');
      expect(case3).toEqual('http://hellolocalhost:2000/world');
      const case4 = rewriteLocalhostURL('https://hellolocalhost:2000/world');
      expect(case4).toEqual('https://hellolocalhost:2000/world');
    });
  });
});
