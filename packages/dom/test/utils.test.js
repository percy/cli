import { styleSheetFromNode, resourceFromDataURL, resourceFromText } from '../src/utils';
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
  });

  describe('resourceFromDataURL', () => {
    const spyResourceFromDataURL = spyOn(window, 'resourceFromDataURL').and.callThrough();
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
    it('Shouldve been called twice', () => {
      expect(spyResourceFromDataURL).toHaveBeenCalled();
      expect(spyResourceFromDataURL.calls.count()).toEqual(2);

    });
  });
  describe('resourceFromText', () => {
    const spyResourceFromText = spyOn(window, 'resourceFromText').and.callThrough();
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
    it('Shouldve been called twice', () => {
      expect(spyResourceFromText).toHaveBeenCalled();
      expect(spyResourceFromDataURL.calls.count()).toEqual(2);
    });
  });
});
