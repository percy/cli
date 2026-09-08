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

    it('roots the snapshot under http://local/', () => {
      // Comparison#upload_snapshot? also requires the root resource URL to
      // include this prefix before it will extract.
      let [root] = createImageSnapshotResources(opts);

      expect(root.url).toContain('http://local/');
    });
  });
});
