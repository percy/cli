import { withExample, replaceDoctype } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeDOM', () => {
  it('returns serialied html, warnings, and resources', () => {
    expect(serializeDOM()).toEqual({
      html: jasmine.any(String),
      warnings: jasmine.any(Array),
      resources: jasmine.any(Array)
    });
  });

  it('optionally returns a stringified response', () => {
    expect(serializeDOM({ stringifyResponse: true }))
      .toMatch('{"html":".*","warnings":\\[\\],"resources":\\[\\]}');
  });

  it('always has a doctype', () => {
    document.removeChild(document.doctype);
    expect(serializeDOM().html).toMatch('<!DOCTYPE html>');
  });

  it('copies existing doctypes', () => {
    let publicId = '-//W3C//DTD XHTML 1.0 Transitional//EN';
    let systemId = 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtdd';

    replaceDoctype('html', publicId);
    expect(serializeDOM().html).toMatch(`<!DOCTYPE html PUBLIC "${publicId}">`);
    replaceDoctype('html', '', systemId);
    expect(serializeDOM().html).toMatch(`<!DOCTYPE html SYSTEM "${systemId}">`);
    replaceDoctype('html', publicId, systemId);
    expect(serializeDOM().html).toMatch(`<!DOCTYPE html PUBLIC "${publicId}" "${systemId}">`);
    replaceDoctype('html');
    expect(serializeDOM().html).toMatch('<!DOCTYPE html>');
  });

  describe('with `domTransformation`', () => {
    beforeEach(() => {
      withExample('<span class="delete-me">Delete me</span>');
      spyOn(console, 'error');
    });

    it('transforms the DOM without modifying the original DOM', () => {
      let { html } = serializeDOM({
        domTransformation(dom) {
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(html).not.toMatch('Delete me');
      expect(document.querySelector('.delete-me').innerText).toBe('Delete me');
    });

    it('logs any errors and returns the serialized DOM', () => {
      let { html } = serializeDOM({
        domTransformation(dom) {
          throw new Error('test error');
          // eslint-disable-next-line no-unreachable
          dom.querySelector('.delete-me').remove();
        }
      });

      expect(html).toMatch('Delete me');
      expect(console.error)
        .toHaveBeenCalledOnceWith('Could not transform the dom:', 'test error');
    });
  });
});
