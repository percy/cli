import { buildPageHtml } from '../src/page-html.js';

describe('@percy/cli-pdf page DOM', () => {
  const opts = {
    title: 'Policy | Page 2',
    imageUrl: 'http://local/Policy/page-2.png',
    width: 1224,
    height: 1584
  };

  it('renders the image at its native size', () => {
    let html = buildPageHtml(opts);

    expect(html).toContain('width="1224px"');
    expect(html).toContain('height="1584px"');
  });

  it('references the image URL byte-for-byte as given', () => {
    let imageUrl = 'http://local/Burglary%20Insurance%20Policy/page-2.png';
    let src = /<img src="([^"]+)"/.exec(buildPageHtml({ ...opts, imageUrl }))[1];

    expect(src).toBe(imageUrl);
  });

  it('escapes the title', () => {
    let html = buildPageHtml({ ...opts, title: '</title><script>alert(1)</script>' });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes quotes in the image URL without re-encoding it', () => {
    let html = buildPageHtml({ ...opts, imageUrl: 'http://local/a"b/page-1.png' });

    expect(html).toContain('&quot;');
    expect(/<img src="http:\/\/local\/a&quot;b\/page-1\.png"/.test(html)).toBe(true);
  });

  it('paints an explicit white background', () => {
    expect(buildPageHtml(opts)).toContain('background: #fff');
  });
});
