import { withExample, replaceDoctype } from 'test/helpers';
import serializeDOM from '@percy/dom';

describe('serializeDOM', () => {
  it('always has a doctype', () => {
    document.removeChild(document.doctype);
    expect(serializeDOM()).toMatch('<!DOCTYPE html>');
  });

  it('copies existing doctypes', () => {
    let publicId = '-//W3C//DTD XHTML 1.0 Transitional//EN';
    let systemId = 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtdd';

    replaceDoctype('html', publicId);
    expect(serializeDOM()).toMatch(`<!DOCTYPE html PUBLIC "${publicId}">`);
    replaceDoctype('html', '', systemId);
    expect(serializeDOM()).toMatch(`<!DOCTYPE html SYSTEM "${systemId}">`);
    replaceDoctype('html', publicId, systemId);
    expect(serializeDOM()).toMatch(`<!DOCTYPE html PUBLIC "${publicId}" "${systemId}">`);
    replaceDoctype('html');
    expect(serializeDOM()).toMatch('<!DOCTYPE html>');
  });

  describe('with `domTransformation`', () => {
    beforeEach(() => {
      withExample('<span class="delete-me">Delete me</span>');
      spyOn(console, 'error');
    });

    it('transforms the DOM without modifying the original DOM', () => {
      let dom = serializeDOM({
        domTransformation(dom) {
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(dom).not.toMatch('Delete me');
      expect(document.querySelector('.delete-me').innerText).toBe('Delete me');
    });

    it('logs any errors and returns the serialized DOM', () => {
      let dom = serializeDOM({
        domTransformation(dom) {
          throw new Error('test error');
          // eslint-disable-next-line no-unreachable
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(dom).toMatch('Delete me');
      expect(console.error)
        .toHaveBeenCalledOnceWith('Could not transform the dom:', 'test error');
    });
  });
});
