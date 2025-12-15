import { fs, logger, setupTest, createTestServer } from './helpers/index.js';
import { generatePromise, AbortController } from '@percy/core/utils';
import Percy from '@percy/core';

describe('Snapshot multiple', () => {
  let percy, server, sitemap;

  beforeEach(async () => {
    sitemap = ['/'];
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    process.env.PERCY_DISABLE_SYSTEM_MONITORING = 'true';
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 50000;
    await setupTest();

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
    delete process.env.PERCY_FORCE_PKG_VALUE;
    delete process.env.PERCY_DISABLE_SYSTEM_MONITORING;
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

    it('snapshots an array of snapshots or urls with sync mode', async () => {
      const promise = {};
      const snapshotList = [
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
      // suppliment the base url for each snapshot
      await percy.snapshot(snapshotList.map(s => {
        if (typeof s === 'string') s = { url: baseUrl + s };
        else s.url = baseUrl + s.url;
        s.sync = true;
        return s;
      }), promise);

      expect(logger.stderr).toEqual([]);
      // since promise will being rejected at time of percy.stop
      Object.values(promise).forEach((p) => p.catch(err => err));
      expect(Object.keys(promise)).toEqual([
        'home',
        '/about',
        '/blog',
        '/blog (page 2)'
      ]);
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
        '[percy:core:snapshot] Received snapshot: home',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Received snapshot: /about',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Received snapshot: /blog',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Additional snapshot: /blog (page 2)'
      ]));
    });

    it('can apply sync option to snapshots', async () => {
      const promise = {};
      await percy.snapshot({
        baseUrl,
        snapshots,
        options: {
          enableJavaScript: true,
          sync: true
        }
      }, promise);

      // since promise will being rejected at time of percy.stop
      Object.values(promise).forEach((p) => p.catch(err => err));
      expect(Object.keys(promise)).toEqual(jasmine.arrayContaining([
        'home',
        '/about',
        '/blog',
        '/blog (page 2)'
      ]));
    });

    it('can supply a function that returns an array of snapshots', async () => {
      let getSnaps = () => [...snapshots, '/pricing'];
      await percy.snapshot({ baseUrl, snapshots: getSnaps });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: home',
        '[percy] Snapshot taken: /about',
        '[percy] Snapshot taken: /blog',
        '[percy] Snapshot taken: /blog (page 2)',
        '[percy] Snapshot taken: /pricing'
      ]));
    });

    it('can supply a function that returns promise only for sync snapshot', async () => {
      const promise = {};
      let getSnaps = () => [...snapshots, { url: '/pricing', sync: true }];
      await percy.snapshot({ baseUrl, snapshots: getSnaps }, promise);

      expect(Object.keys(promise)).toEqual(['/pricing']);
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

    it('rejects when missing snapshots', async () => {
      await expectAsync(
        percy.snapshot({ baseUrl, snapshots: () => [] })
      ).toBeRejectedWithError('No snapshots found');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([]);
    });

    it('can filter snapshots by name', async () => {
      snapshots.push('/skip', '/do-not/skip');
      await percy.snapshot({ baseUrl, snapshots, exclude: ['/skip'] });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: home',
        '[percy] Snapshot taken: /about',
        '[percy] Snapshot taken: /blog',
        '[percy] Snapshot taken: /blog (page 2)',
        '[percy] Snapshot taken: /do-not/skip'
      ]));
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

    it('snapshots urls from a sitemap url', async () => {
      await percy.stop(true);

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000], sync: true },
        discovery: { concurrency: 1 },
        clientInfo: 'client-info',
        environmentInfo: 'env-info',
        server: false
      });
      sitemap.push('/one', '/two');
      const promise = {};
      await percy.snapshot('http://localhost:8000/sitemap.xml', promise);

      // since promise will being rejected at time of percy.stop
      Object.values(promise).forEach((p) => p.catch(err => err));
      expect(Object.keys(promise)).toEqual([
        '/',
        '/one',
        '/two'
      ]);
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
        '[percy:core:snapshot] Received snapshot: /',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Received snapshot: /foo',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Received snapshot: /bar',
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
        '[percy:core:snapshot] Received snapshot: /',
        '[percy:core:snapshot] Received snapshot: /about',
        '[percy:core:snapshot] Received snapshot: /blog/foo',
        '[percy:core:snapshot] - enableJavaScript: true',
        '[percy:core:snapshot] Received snapshot: /blog/bar',
        '[percy:core:snapshot] - enableJavaScript: true'
      ]));
    });

    it('can supply a base-url to serve files at', async () => {
      await percy.snapshot({
        serve: './public',
        baseUrl: '/foo/bar',
        cleanUrls: true
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /foo/bar',
        '[percy] Snapshot taken: /foo/bar/about',
        '[percy] Snapshot taken: /foo/bar/blog/foo',
        '[percy] Snapshot taken: /foo/bar/blog/bar'
      ]));
    });

    it('closes the server when aborted', async () => {
      let ctrl = new AbortController();
      let client = percy.client;

      // cancel after the first snapshot is uploaded
      spyOn(client, 'createSnapshot').and.callFake((...args) => {
        if (!client.createSnapshot.calls.count()) ctrl.abort();
        return client.createSnapshot.and.originalFn.apply(client, args);
      });

      await generatePromise((
        // #yield.snapshot returns a generator that can be aborted
        percy.yield.snapshot({ serve: './public' })
      ), ctrl.signal);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: /about.html',
        '[percy] Snapshot taken: /index.html'
      ]));
    });
  });
});
