import { resourceFromDataURL, resourceFromText, rewriteLocalhostURL, styleSheetFromNode } from '../src/utils';
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
    it('should rewrite non-http(s) schemes to http://render.percy.local', () => {
      const case1 = rewriteLocalhostURL('file:///path/to/file.html');
      expect(case1).toEqual('http://render.percy.local/path/to/file.html');
      const case2 = rewriteLocalhostURL('data:image/png;base64,iVBORw0KGg');
      expect(case2).toEqual('http://render.percy.localimage/png;base64,iVBORw0KGg');
      const case3 = rewriteLocalhostURL('chrome-extension://abc123/popup.html');
      expect(case3).toEqual('http://render.percy.local/popup.html');
      const case4 = rewriteLocalhostURL('ftp://example.com/file.txt');
      expect(case4).toEqual('http://render.percy.local/file.txt');
    });
    it('should preserve pathname, search params and hash for non-http(s) schemes', () => {
      const case1 = rewriteLocalhostURL('file:///path/to/file.html?query=value#section');
      expect(case1).toEqual('http://render.percy.local/path/to/file.html?query=value#section');
      const case2 = rewriteLocalhostURL('chrome-extension://abc123/popup.html?tab=1#top');
      expect(case2).toEqual('http://render.percy.local/popup.html?tab=1#top');
      const case3 = rewriteLocalhostURL('file:///index.html#header');
      expect(case3).toEqual('http://render.percy.local/index.html#header');
    });
  });
});
