import { resourceFromDataURL, resourceFromText, styleSheetFromNode } from '../src/utils';
describe('utils', () => {
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
    // PPLT-6109: the URL is root-relative regardless of document.URL -- it is
    // same-origin by construction, so it never needs a host or scheme baked in.
    it('builds a root-relative URL regardless of document.URL', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://localhost'
      });
      const result = resourceFromDataURL(uid, dataURL);
      expect(result).toEqual({
        url: `/__serialized__/${uid}.png`,
        content: 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+',
        mimetype: 'image/png'
      });
    });
    it('builds the same root-relative URL for a non-localhost document.URL', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://example.com'
      });
      const result = resourceFromDataURL(uid, dataURL);
      expect(result).toEqual({
        url: `/__serialized__/${uid}.png`,
        content: 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+',
        mimetype: 'image/png'
      });
    });
  });
  describe('resourceFromText', () => {
    const uid = (Math.random() + 1).toString(36).substring(10);
    const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAXNSR0IArs4c6QAACbVJREFUeF7tXAWoFVEQnW+';
    it('builds a root-relative URL regardless of document.URL', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://localhost'
      });
      const result = resourceFromText(uid, 'image/png', dataURL);
      expect(result).toEqual({
        url: `/__serialized__/${uid}.png`,
        content: dataURL,
        mimetype: 'image/png'
      });
    });
    it('builds the same root-relative URL for a non-localhost document.URL', () => {
      Object.defineProperty(window.document, 'URL', {
        writable: true,
        value: 'http://example.com'
      });
      const result = resourceFromText(uid, 'image/png', dataURL);
      expect(result).toEqual({
        url: `/__serialized__/${uid}.png`,
        content: dataURL,
        mimetype: 'image/png'
      });
    });
  });
});
