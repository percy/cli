import {
  buildImageSnapshotHtml,
  createImageSnapshotResources
} from '../src/utils.js';

// Verbatim from percy-api: lib/percy/workloads/api/start_comparison_job.rb,
// extract_and_process_upload_snapshot. If the wrapper stops matching this,
// extraction raises, percy-api rescues, and every image-backed snapshot
// silently falls back to being rendered -- slower, with no error surfaced.
const PERCY_API_IMG_REGEX = /<img\s+src="([^"]+)"\s+width="(\d+)px"\s+height="(\d+)px"/;

describe('image snapshot resources', () => {
  let opts = {
    name: 'shot.png',
    rootUrl: 'http://local/shot.png',
    imageUrl: 'http://local/shot.png',
    width: 640,
    height: 360,
    content: Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
    mimetype: 'image/png'
  };

  describe('buildImageSnapshotHtml', () => {
    it('matches the regex percy-api extracts the image with', () => {
      let match = PERCY_API_IMG_REGEX.exec(buildImageSnapshotHtml(opts));

      expect(match).not.toBeNull();
      expect(match[1]).toBe('http://local/shot.png');
      expect(match[2]).toBe('640');
      expect(match[3]).toBe('360');
    });

    it('still matches when the URL is percent-encoded', () => {
      let imageUrl = 'http://local/Burglary%20Policy/page-2.png';
      let match = PERCY_API_IMG_REGEX.exec(buildImageSnapshotHtml({ ...opts, imageUrl }));

      expect(match[1]).toBe(imageUrl);
    });

    it('emits integer dimensions with px suffixes', () => {
      // percy-api's capture groups are \d+ followed by a literal px; a
      // fractional or unsuffixed dimension would not match at all.
      let html = buildImageSnapshotHtml({ ...opts, width: 1224, height: 1584 });

      expect(html).toContain('width="1224px"');
      expect(html).toContain('height="1584px"');
    });

    it('escapes the name and the image URL', () => {
      let html = buildImageSnapshotHtml({
        ...opts,
        name: '</title><script>alert(1)</script>',
        imageUrl: 'http://local/a"b.png'
      });

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&quot;');
    });

    it('leaves an apostrophe in the URL intact', () => {
      // encodeURIComponent does not encode `'`, so escaping it here would make
      // the src diverge from the registered resource URL and extraction would
      // silently miss. The attribute is double-quoted, so `'` cannot break out.
      let imageUrl = `http://local/${encodeURIComponent("Jack's Resume")}/page-1.png`;

      expect(imageUrl).toContain("Jack's");
      expect(PERCY_API_IMG_REGEX.exec(buildImageSnapshotHtml({ ...opts, imageUrl }))[1])
        .toBe(imageUrl);
    });

    it('leaves angle brackets in the URL intact', () => {
      // `<` and `>` are inert inside a double-quoted attribute. They cannot
      // reach here from encodeURIComponent, but rewriting them would be the
      // same class of contract break as the apostrophe.
      let imageUrl = 'http://local/a<b>c.png';

      expect(PERCY_API_IMG_REGEX.exec(buildImageSnapshotHtml({ ...opts, imageUrl }))[1])
        .toBe(imageUrl);
    });

    it('does not re-encode an already-encoded URL', () => {
      // encodeURI over an encoded URL turns %20 into %2520; the img src then
      // matches no registered resource and the snapshot renders blank.
      let imageUrl = 'http://local/a%20b.png';

      expect(buildImageSnapshotHtml({ ...opts, imageUrl })).toContain(`src="${imageUrl}"`);
    });
  });

  describe('createImageSnapshotResources', () => {
    it('returns a root resource and the image', () => {
      let [root, image] = createImageSnapshotResources(opts);

      expect(root.root).toBe(true);
      expect(root.mimetype).toBe('text/html');
      expect(root.url).toBe('http://local/shot.png');
      expect(image.mimetype).toBe('image/png');
      expect(image.content).toBe(opts.content);
    });

    it('keeps the img src and the image resource URL identical', () => {
      let [root, image] = createImageSnapshotResources({
        ...opts,
        imageUrl: 'http://local/my%20doc/page-1.png'
      });

      expect(PERCY_API_IMG_REGEX.exec(root.content)[1]).toBe(image.url);
    });

    it('keeps src and resource URL identical for every name encodeURIComponent passes through', () => {
      // encodeURIComponent leaves these literal: ! ' ( ) * - . _ ~
      // Each one therefore reaches the wrapper as-is and must survive it
      // unchanged, or percy-api extracts a URL that matches no resource and the
      // page is silently re-rendered instead of extracted.
      for (let name of ["Jack's Resume", 'a!b', 'c(d)e', 'f*g', 'h-i_j.k~l', "O'Neill (2024)"]) {
        let imageUrl = `http://local/${encodeURIComponent(name)}/page-1.png`;
        let [root, image] = createImageSnapshotResources({ ...opts, name, imageUrl });
        let match = PERCY_API_IMG_REGEX.exec(root.content);

        expect(match).withContext(name).not.toBeNull();
        expect(match[1]).withContext(name).toBe(image.url);
      }
    });

    it('roots the snapshot under http://local/', () => {
      // Comparison#upload_snapshot? also requires the root resource URL to
      // include this prefix before it will extract.
      let [root] = createImageSnapshotResources(opts);

      expect(root.url).toContain('http://local/');
    });
  });
});
