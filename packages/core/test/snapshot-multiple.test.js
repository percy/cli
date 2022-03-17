import { fs, logger, setupTest, createTestServer } from './helpers';
import Percy from '../src';

describe('Snapshot multiple', () => {
  let percy, server, sitemap;

  beforeEach(async () => {
    sitemap = ['/'];
    setupTest();

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 },
      clientInfo: 'client-info',
      environmentInfo: 'env-info',
      server: false
    });

    server = await createTestServer({
      default: () => [200, 'text/html', '<p>Test</p>'],
      '/sitemap.xml': () => [200, 'application/xml', [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...sitemap.map(p => `  <url><loc>http://localhost:8000${p}</loc></url>`),
        '</urlset>'
      ].join('\n')]
    });

    logger.reset(true);
  });

  afterEach(async () => {
    await percy.stop(true);
    await server?.close();
  });

  describe('list syntax', () => {
    const baseUrl = 'http://localhost:8000';
    const snapshots = [
      { url: '/', name: 'home' },
      '/about',
      {
        url: '/blog',
        additionalSnapshots: [{
          suffix: ' (page 2)',
          execute: () => window.location += '?page=2'
        }]
      }
    ];

    it('snapshots an array of snapshots or urls', async () => {
      // suppliment the base url for each snapshot
      await percy.snapshot(snapshots.map(s => {
        if (typeof s === 'string') s = baseUrl + s;
        else s.url = baseUrl + s.url;
        return s;
      }));

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: home',
        '[percy] Snapshot taken: /about',
        '[percy] Snapshot taken: /blog',
        '[percy] Snapshot taken: /blog (page 2)'
      ]));
    });

    it('can supply a base-url for all snapshots', async () => {
      await percy.snapshot({ baseUrl, snapshots });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: home',
        '[percy] Snapshot taken: /about',
        '[percy] Snapshot taken: /blog',
        '[percy] Snapshot taken: /blog (page 2)'
      ]));
    });

    it('can apply additional options to snapshots', async () => {
      percy.loglevel('debug');

      await percy.snapshot({
        baseUrl,
        snapshots,
        options: {
          enableJavaScript: true
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy:core] Snapshot taken: home',
        '[percy:core] Snapshot taken: /about',
        '[percy:core] Snapshot taken: /blog',
        '[percy:core] Snapshot taken: /blog (page 2)'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:snapshot] Handling snapshot: home',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Handling snapshot: /about',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Handling snapshot: /blog',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Additional snapshot: /blog (page 2)'
      ]));
    });

    it('throws with invalid or missing URLs', () => {
      expect(() => percy.snapshot([
        'http://localhost:8000/valid',
        'http://localhost:invalid/'
      ])).toThrowError(
        'Invalid snapshot URL: http://localhost:invalid/'
      );

      expect(() => percy.snapshot([
        'http://localhost:8000/valid',
        { name: 'missing' }
      ])).toThrowError(
        'Missing required URL for snapshot'
      );
    });
  });

  describe('sitemap syntax', () => {
    it('snapshots urls from a sitemap url', async () => {
      sitemap.push('/one', '/two');

      await percy.snapshot('http://localhost:8000/sitemap.xml');

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /',
        '[percy] Snapshot taken: /one',
        '[percy] Snapshot taken: /two'
      ]));
    });

    it('optionally filters sitemap urls to snapshot', async () => {
      sitemap = Array.from({ length: 20 }, (_, i) => `/${i + 1}`);

      await percy.snapshot({
        sitemap: 'http://localhost:8000/sitemap.xml',
        include: [/^\/[1-3]$/, '/1{0,1,2}', s => parseInt(s.name.substr(1)) >= 18],
        exclude: '/0$/'
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /1',
        '[percy] Snapshot taken: /2',
        '[percy] Snapshot taken: /3',
        '[percy] Snapshot taken: /11',
        '[percy] Snapshot taken: /12',
        '[percy] Snapshot taken: /18',
        '[percy] Snapshot taken: /19'
      ]));
    });

    it('can apply additional options to snapshots', async () => {
      sitemap.push('/foo', '/bar');
      percy.loglevel('debug');

      await percy.snapshot({
        sitemap: 'http://localhost:8000/sitemap.xml',
        options: [
          { enableJavaScript: true },
          { include: '/bar', enableJavaScript: false }
        ]
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy:core] Snapshot taken: /',
        '[percy:core] Snapshot taken: /foo',
        '[percy:core] Snapshot taken: /bar'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:snapshot] Handling snapshot: /',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Handling snapshot: /foo',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Handling snapshot: /bar',
        '[percy:core:snapshot] - enableJavaScript: false'
      ]));
    });

    it('throws when given an invalid sitemap', async () => {
      await expectAsync(percy.snapshot({
        sitemap: 'http://localhost:8000/not-a-sitemap'
      })).toBeRejectedWithError(
        'The sitemap must be an XML document, but the content-type was "text/html"'
      );
    });

    it('throws when a sitemap is empty', async () => {
      sitemap = [];

      await expectAsync(percy.snapshot({
        sitemap: 'http://localhost:8000/sitemap.xml'
      })).toBeRejectedWithError('No snapshots found');
    });
  });

  describe('server syntax', () => {
    beforeEach(async () => {
      fs.$vol.fromJSON({
        './public/index.html': 'index',
        './public/about.html': 'about',
        './public/blog/foo.html': 'foo',
        './public/blog/bar.html': 'bar'
      });
    });

    it('throws when the directory cannot be found', async () => {
      await expectAsync(percy.snapshot({ serve: './output' }))
        .toBeRejectedWithError('Not found: ./output');
    });

    it('serves and snapshots a static directory', async () => {
      await percy.snapshot({ serve: './public' });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /index.html',
        '[percy] Snapshot taken: /about.html',
        '[percy] Snapshot taken: /blog/foo.html',
        '[percy] Snapshot taken: /blog/bar.html'
      ]));
    });

    it('accepts an array of specific snapshots', async () => {
      await percy.snapshot({
        serve: './public',
        snapshots: ['/index.html', '/about.html']
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /index.html',
        '[percy] Snapshot taken: /about.html'
      ]));
      expect(logger.stdout).not.toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /blog/foo.html',
        '[percy] Snapshot taken: /blog/bar.html'
      ]));
    });

    it('optionally filters or rewrites snapshots', async () => {
      await percy.snapshot({
        serve: './public',
        include: '/blog/*',
        rewrites: {
          '/blog/:name': '/blog/:name.html'
        }
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /blog/foo',
        '[percy] Snapshot taken: /blog/bar'
      ]));
    });

    it('can apply additional options to snapshots', async () => {
      percy.loglevel('debug');

      await percy.snapshot({
        serve: './public',
        cleanUrls: true,
        options: {
          include: '/blog/*',
          enableJavaScript: true
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy:core] Snapshot taken: /',
        '[percy:core] Snapshot taken: /about',
        '[percy:core] Snapshot taken: /blog/foo',
        '[percy:core] Snapshot taken: /blog/bar'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:snapshot] Handling snapshot: /',
        '[percy:core:snapshot] Handling snapshot: /about',
        '[percy:core:snapshot] Handling snapshot: /blog/foo',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Handling snapshot: /blog/bar',
        '[percy:core:snapshot] - enableJavaScript: true'
      ]));
    });
  });
});
