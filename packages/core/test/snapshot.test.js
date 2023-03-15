import { sha256hash, base64encode } from '@percy/client/utils';
import { logger, api, setupTest, createTestServer, dedent } from './helpers/index.js';
import { waitFor } from '@percy/core/utils';
import Percy from '@percy/core';

describe('Snapshot', () => {
  let percy, server, testDOM;

  beforeEach(async () => {
    testDOM = '<p>Test</p>';
    await setupTest();

    server = await createTestServer({
      default: () => [200, 'text/html', testDOM],
      '/foo': () => [200, 'text/html', '<p>Foo</p>'],
      '/framed': () => [200, 'text/html', '<iframe src="/"/>']
    });

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 },
      clientInfo: 'client-info',
      environmentInfo: 'env-info',
      server: false
    });

    logger.reset(true);
  });

  afterEach(async () => {
    await percy.stop(true);
    await server?.close();
  });

  it('errors when not running', async () => {
    await percy.stop();
    expect(() => percy.snapshot({})).toThrowError('Not running');
  });

  it('errors when missing a url', () => {
    expect(() => percy.snapshot({ name: 'test snapshot' }))
      .toThrowError('Missing required URL for snapshot');
  });

  it('warns when missing additional snapshot names', async () => {
    await percy.snapshot({
      url: 'http://localhost:8000',
      additionalSnapshots: [{
        waitForTimeout: 10
      }, {
        name: 'nombre',
        suffix: ' - 1',
        waitForTimeout: 10
      }]
    });

    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - additionalSnapshots[0]: missing required name, prefix, or suffix',
      '[percy] - additionalSnapshots[1]: prefix & suffix are ignored when a name is provided'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: /',
      '[percy] Snapshot taken: nombre'
    ]);
  });

  it('warns when providing conflicting options', async () => {
    await percy.snapshot({
      url: 'http://localhost:8000',
      domSnapshot: '<html></html>',
      waitForTimeout: 3,
      waitForSelector: 'd',
      execute: 'e',
      additionalSnapshots: [{ prefix: 'f' }],
      foobar: 'baz'
    });

    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - waitForTimeout: not accepted with DOM snapshots',
      '[percy] - waitForSelector: not accepted with DOM snapshots',
      '[percy] - execute: not accepted with DOM snapshots',
      '[percy] - additionalSnapshots: not accepted with DOM snapshots',
      '[percy] - foobar: unknown property'
    ]);
  });

  it('warns if options are invalid', async () => {
    await percy.snapshot({
      name: 'invalid snapshot',
      url: 'http://localhost:8000',
      widths: ['not-a-width'],
      minHeight: 4000,
      discovery: {
        allowedHostnames: [
          'http://what-am-i-doing.com',
          'still-not-a-hostname.io/with-a-path',
          'finally.a-real.hostname.org'
        ]
      },
      additionalSnapshots: [{
        suffix: '-test',
        execute: { beforeSnapshot: () => {} }
      }]
    });

    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - widths[0]: must be an integer, received a string',
      '[percy] - minHeight: must be <= 2000',
      '[percy] - discovery.allowedHostnames[0]: must not include a protocol',
      '[percy] - discovery.allowedHostnames[1]: must not include a pathname',
      '[percy] - additionalSnapshots[0].execute: must be a function, function body, or array of functions'
    ]);
  });

  it('warns on deprecated options', async () => {
    await percy.snapshot([
      { url: 'http://localhost:8000/a', devicePixelRatio: 2 }
    ]);

    expect(logger.stderr).toEqual([
      '[percy] Warning: The snapshot option `devicePixelRatio` ' +
        'will be removed in 2.0.0. Use `discovery.devicePixelRatio` instead.'
    ]);
  });

  it('errors if the url is invalid', async () => {
    await percy.snapshot({
      name: 'test snapshot',
      url: 'wat:/localhost:8000'
    });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Encountered an error taking snapshot: test snapshot',
      '[percy] Error: Navigation failed: net::ERR_ABORTED'
    ]));
  });

  it('handles missing snapshot widths', async () => {
    let url = 'http://localhost:8000';
    percy.loglevel('debug');

    percy.config.snapshot.widths = [600];
    await percy.snapshot({ url, widths: [] });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:snapshot] - widths: 600px'
    ]));

    percy.config.snapshot.widths = [];
    await percy.snapshot({ url, widths: [] });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:snapshot] - widths: 375px, 1280px'
    ]));
  });

  it('does not duplicate resources when sites redirect', async () => {
    await percy.snapshot({
      url: 'http://localhost:8000/',
      execute() { window.history.pushState(null, null, '#/'); }
    });

    let resourceURLs = api.requests['/builds/123/snapshots'][0]
      .body.data.relationships.resources.data.map(r => r.attributes['resource-url']);
    let uniqueURLs = [...new Set(resourceURLs)];

    expect(resourceURLs.length).toEqual(uniqueURLs.length);
  });

  it('uploads snapshots before the next one when delayed', async () => {
    // stop and recreate a percy instance with the desired option
    await percy.stop(true);
    await api.mock();

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      delayUploads: true
    });

    // not requested on start
    expect(api.requests['/builds']).toBeUndefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();

    await percy.snapshot('http://localhost:8000/one');
    await percy.idle();

    // build created, not yet uploaded
    expect(api.requests['/builds']).toBeDefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();

    await percy.snapshot('http://localhost:8000/two');
    await percy.idle();

    // one snapshot uploaded, second one queued
    expect(api.requests['/builds/123/snapshots']).toHaveSize(1);

    let root = i => api.requests['/builds/123/snapshots'][i]
      .body.data.relationships.resources.data.find(r => r.attributes['is-root']);

    expect(root(0)).toHaveProperty('attributes.resource-url', 'http://localhost:8000/one');

    await percy.stop();

    // all snapshots uploaded, build finalized
    expect(api.requests['/builds/123/snapshots']).toHaveSize(2);
    expect(api.requests['/builds/123/finalize']).toBeDefined();

    expect(root(1)).toHaveProperty('attributes.resource-url', 'http://localhost:8000/two');
  });

  it('does not upload delayed snapshots when skipping', async () => {
    // stop and recreate a percy instance with the desired option
    await percy.stop(true);
    await api.mock();

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      delayUploads: true,
      // skip should be prioritized over delay
      skipUploads: true
    });

    await percy.snapshot('http://localhost:8000/one');
    await percy.snapshot('http://localhost:8000/two');
    await percy.idle();

    // not requested, ever
    expect(api.requests['/builds']).toBeUndefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();
  });

  it('uploads remaining snapshots at the end when delayed', async () => {
    // stop and recreate a percy instance with the desired option
    await percy.stop(true);
    await api.mock({ delay: 50 });

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      discovery: { concurrency: 1 },
      delayUploads: true
    });

    // delay build creation to ensure uploads are queued whens stopping
    let resolveBuild;

    api.reply('/builds', () => new Promise(resolve => {
      resolveBuild = () => resolve(api.DEFAULT_REPLIES['/builds']());
    }));

    // take several snapshots before resolving the build
    await Promise.all(Array.from({ length: 5 }, (_, i) => (
      percy.snapshot(`http://localhost:8000/${i}`)
    )));

    // resolve after stopping to test that uploads don't start before build creation
    setTimeout(() => resolveBuild(), 100);
    await percy.stop();

    // all uploaded after stopping
    expect(api.requests['/builds']).toBeDefined();
    expect(api.requests['/builds/123/snapshots']).toHaveSize(5);
    expect(api.requests['/builds/123/finalize']).toBeDefined();

    let roots = api.requests['/builds/123/snapshots'].map(s =>
      s.body.data.relationships.resources.data.find(r => r.attributes['is-root']));

    for (let i = 0; i < 5; i++) {
      expect(roots[i]).toHaveProperty('attributes.resource-url', `http://localhost:8000/${i}`);
    }
  });

  it('uploads all snapshots at the end when deferred', async () => {
    // stop and recreate a percy instance with the desired option
    await percy.stop(true);
    await api.mock();

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      deferUploads: true
    });

    // not requested on start
    expect(api.requests['/builds']).toBeUndefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();

    await percy.snapshot('http://localhost:8000/one');
    await percy.snapshot('http://localhost:8000/two');
    await percy.idle();

    // still nothing
    expect(api.requests['/builds']).toBeUndefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();

    await percy.stop();

    // all uploaded after stopping
    expect(api.requests['/builds']).toBeDefined();
    expect(api.requests['/builds/123/snapshots']).toHaveSize(2);
    expect(api.requests['/builds/123/finalize']).toBeDefined();

    let roots = api.requests['/builds/123/snapshots'].map(s =>
      s.body.data.relationships.resources.data.find(r => r.attributes['is-root']));

    expect(roots[0]).toHaveProperty('attributes.resource-url', 'http://localhost:8000/one');
    expect(roots[1]).toHaveProperty('attributes.resource-url', 'http://localhost:8000/two');
  });

  it('uploads named snapshots with differing root widths when deferred', async () => {
    // stop and recreate a percy instance with the desired option
    await percy.stop(true);
    await api.mock({ delay: 50 });

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      discovery: { concurrency: 1 },
      deferUploads: true
    });

    let snap = (domSnapshot, widths) => percy.snapshot({
      [Array.isArray(widths) ? 'widths' : 'width']: widths,
      url: 'http://localhost:8000/',
      domSnapshot
    });

    snap('xs width', [400, 600]);
    snap('sm widths', [400, 600, 800]);
    snap('med widths', [800, 1000, 1200]);
    snap('lg widths', 1200);
    await percy.idle();

    // deferred still works as expected
    expect(api.requests['/builds']).toBeUndefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();

    await percy.stop();

    // single snapshot uploaded after stopping
    expect(api.requests['/builds/123/snapshots']).toHaveSize(1);

    // snapshot should contain 3 roots of differing widths
    let roots = api.requests['/builds/123/snapshots'][0].body.data
      .relationships.resources.data.filter(r => r.attributes['is-root']);

    expect(roots).toHaveSize(3);
    expect(roots[0]).toHaveProperty('attributes.for-widths', [1200]);
    expect(roots[1]).toHaveProperty('attributes.for-widths', [800, 1000]);
    expect(roots[2]).toHaveProperty('attributes.for-widths', [400, 600]);

    // roots have the same URL, but different SHA IDs
    expect(roots[0].attributes['resource-url'])
      .toEqual(roots[1].attributes['resource-url']);
    expect(roots[1].attributes['resource-url'])
      .toEqual(roots[2].attributes['resource-url']);
    expect(roots[0].id).not.toEqual(roots[1].id);
    expect(roots[1].id).not.toEqual(roots[2].id);
  });

  it('can capture snapshots with multiple root widths when deferred', async () => {
    server.reply('/styles.css', () => [200, 'text/css', '@import "/coverage.css"']);
    server.reply('/coverage.css', () => [200, 'text/css', 'p { color: purple; }']);
    // stop and recreate a percy instance with the desired option
    await percy.stop(true);
    await api.mock();
    logger.reset();

    testDOM = `
      <p id="test"></p>
      <link rel="stylesheet" href="/styles.css"/>
      <script>(window.onresize = () => {
        let width = window.innerWidth;
        if (width <= 600) test.innerText = 'small';
        if (width > 600) test.innerText = 'medium';
        if (width > 1000) test.innerText = 'large';
      })()</script>
    `;

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      deferUploads: true,
      loglevel: 'debug',
      // delay should do nothing
      delayUploads: true
    });

    percy.snapshot({
      name: 'Snapshot 0',
      url: 'http://localhost:8000/',
      additionalSnapshots: [{ name: 'Snapshot 1' }],
      widths: [600, 1000, 1600]
    });

    await percy.idle();

    // deferred still works as expected
    expect(api.requests['/builds']).toBeUndefined();
    expect(api.requests['/builds/123/snapshots']).toBeUndefined();

    await percy.stop();

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:page] Taking snapshot: Snapshot 0 @600px',
      '[percy:core:page] Taking snapshot: Snapshot 0 @1000px',
      '[percy:core:page] Taking snapshot: Snapshot 0 @1600px',
      '[percy:core:page] Taking snapshot: Snapshot 1 @600px',
      '[percy:core:page] Taking snapshot: Snapshot 1 @1000px',
      '[percy:core:page] Taking snapshot: Snapshot 1 @1600px'
    ]));

    // snapshots uploaded after stopping
    expect(api.requests['/builds/123/snapshots']).toHaveSize(2);

    for (let i in api.requests['/builds/123/snapshots']) {
      let req = api.requests['/builds/123/snapshots'][i];
      expect(req).toHaveProperty('body.data.attributes.name', `Snapshot ${i}`);

      // snapshots should contain 3 roots of differing widths
      let roots = req.body.data.relationships
        .resources.data.filter(r => r.attributes['is-root']);

      expect(roots).toHaveSize(3);
      expect(roots[0]).toHaveProperty('attributes.for-widths', [1600]);
      expect(roots[1]).toHaveProperty('attributes.for-widths', [1000]);
      expect(roots[2]).toHaveProperty('attributes.for-widths', [600]);

      let captured = roots.map(({ id }) => Buffer.from((
        api.requests['/builds/123/resources']
          .find(r => r.body.data.id === id)?.body
          .data.attributes['base64-content']
      ), 'base64').toString());

      expect(captured[0]).toMatch('<p id="test">large</p>');
      expect(captured[1]).toMatch('<p id="test">medium</p>');
      expect(captured[2]).toMatch('<p id="test">small</p>');
    }
  });

  it('logs after taking the snapshot', async () => {
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: test snapshot'
    ]);
  });

  it('logs any encountered errors when snapshotting', async () => {
    // sabatoge something to cause an unexpected error
    spyOn(percy.browser, 'page').and.rejectWith(
      new Error('unexpected snapshot error'));

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Encountered an error taking snapshot: test snapshot',
      '[percy] Error: unexpected snapshot error'
    ]);
  });

  it('logs any encountered errors when uploading', async () => {
    api.reply('/builds/123/snapshots', () => [401, {
      errors: [{ detail: 'unexpected upload error' }]
    }]);

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    await percy.idle();

    // snapshot gets taken but will not upload
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: test snapshot'
    ]);
    expect(logger.stderr).toEqual([
      '[percy] Encountered an error uploading snapshot: test snapshot',
      '[percy] Error: unexpected upload error'
    ]);
  });

  it('logs detailed debug logs', async () => {
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      client_info: 'test client info',
      environment_info: 'test env info',
      widths: [400, 1200],
      discovery: {
        'allowed-hostnames': ['example.com'],
        'request-headers': { 'X-Foo': 'Bar' },
        'disable-cache': true
      },
      additionalSnapshots: [
        { prefix: 'foo ', waitForTimeout: 100 },
        { prefix: 'foo ', suffix: ' bar', waitForTimeout: 200 },
        { name: 'foobar', waitForSelector: 'p', execute() {} }
      ]
    });

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy:core] Snapshot taken: test snapshot',
      '[percy:core] Snapshot taken: foo test snapshot',
      '[percy:core] Snapshot taken: foo test snapshot bar',
      '[percy:core] Snapshot taken: foobar'
    ]));

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:snapshot] ---------',
      '[percy:core:snapshot] Received snapshot: test snapshot',
      '[percy:core:snapshot] - url: http://localhost:8000/',
      '[percy:core:snapshot] - widths: 400px, 1200px',
      '[percy:core:snapshot] - minHeight: 1024px',
      '[percy:core:snapshot] - discovery.allowedHostnames: localhost, example.com',
      '[percy:core:snapshot] - discovery.requestHeaders: {"X-Foo":"Bar"}',
      '[percy:core:snapshot] - discovery.disableCache: true',
      '[percy:core:snapshot] - clientInfo: test client info',
      '[percy:core:snapshot] - environmentInfo: test env info',
      '[percy:core:snapshot] Additional snapshot: foo test snapshot',
      '[percy:core:snapshot] - waitForTimeout: 100',
      '[percy:core:snapshot] Additional snapshot: foo test snapshot bar',
      '[percy:core:snapshot] - waitForTimeout: 200',
      '[percy:core:snapshot] Additional snapshot: foobar',
      '[percy:core:snapshot] - waitForSelector: p',
      '[percy:core:snapshot] - execute: execute() {}'
    ]));
  });

  it('logs alternate dry-run logs', async () => {
    await percy.stop(true);
    percy = await Percy.start({ dryRun: true });
    logger.reset();

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      additionalSnapshots: [
        { prefix: 'foo ', waitForTimeout: 100 },
        { prefix: 'foo ', suffix: ' bar', waitForTimeout: 200 },
        { name: 'foobar', waitForSelector: '.ready', execute() {} }
      ]
    });

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot found: test snapshot',
      '[percy] Snapshot found: foo test snapshot',
      '[percy] Snapshot found: foo test snapshot bar',
      '[percy] Snapshot found: foobar'
    ]);
  });

  it('accepts multiple dom snapshots', async () => {
    await percy.snapshot([{
      url: 'http://localhost:8000/one',
      domSnapshot: testDOM
    }, {
      url: 'http://localhost:8000/two',
      dom_snapshot: testDOM
    }, {
      url: 'http://localhost:8000/three',
      'dom-snapshot': testDOM
    }, {
      url: 'http://localhost:8000/four',
      domSnapshot: JSON.stringify({ html: testDOM })
    }]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: /one',
      '[percy] Snapshot taken: /two',
      '[percy] Snapshot taken: /three',
      '[percy] Snapshot taken: /four'
    ]);
  });

  it('accepts serialized dom resources', async () => {
    let resource = {
      url: 'http://localhost:8000/__serialized__/_id123.gif',
      content: 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
      mimetype: 'image/gif'
    };

    let textResource = {
      url: 'http://localhost:8000/__serialized__/_style1.css',
      content: 'p{color:blue;}',
      mimetype: 'text/css'
    };

    await percy.snapshot({
      name: 'Serialized Snapshot',
      url: 'http://localhost:8000/',
      domSnapshot: {
        html: `<img src="${resource.url}"/>`,
        warnings: ['Test serialize warning'],
        resources: [resource, textResource]
      }
    });

    // test serialization warnings
    expect(logger.stderr).toEqual([
      '[percy] Encountered snapshot serialization warnings:',
      '[percy] - Test serialize warning'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: Serialized Snapshot'
    ]);

    // wait for uploads to assert against
    await percy.idle();

    let uploads = api.requests['/builds/123/resources']
      .map(r => r.body.data.attributes['base64-content']);

    // domSnapshot.html is the root resource
    expect(Buffer.from(uploads[0], 'base64').toString())
      .toMatch(`<img src="${resource.url}"/>`);
    // domSnapshot.resources are also uploaded
    expect(uploads[1]).toEqual(resource.content);
    expect(uploads[2]).toEqual(Buffer.from(textResource.content).toString('base64'));
  });

  it('handles duplicate snapshots', async () => {
    await percy.snapshot([{
      url: 'http://localhost:8000/foobar',
      domSnapshot: '<p>Test 1</p>'
    }, {
      url: 'http://localhost:8000/foobar',
      domSnapshot: '<p>Test 2</p>'
    }]);

    expect(logger.stderr).toEqual([
      '[percy] Received a duplicate snapshot, ' +
        'the previous snapshot was aborted: /foobar'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: /foobar'
    ]);
  });

  it('handles the browser closing early', async () => {
    // close the browser after a page target is created
    spyOn(percy.browser, 'send').and.callFake((...args) => {
      let send = percy.browser.send.and.originalFn.apply(percy.browser, args);
      if (args[0] === 'Target.createTarget') percy.browser.close();
      return send;
    });

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Encountered an error taking snapshot: test snapshot',
      jasmine.stringMatching('Protocol error \\(Target\\.createTarget\\): Browser closed')
    ]));
  });

  it('handles the page closing early', async () => {
    let accessed = 0;

    testDOM += '<link rel="stylesheet" href="/style.css"/>';
    server.reply('/style.css', () => new Promise(resolve => {
      if (!accessed++) return resolve([200, 'text/css', '']);
      setTimeout(resolve, 500, [200, 'text/css', '']);
    }));

    let snap = percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    // wait until an asset has at least been requested
    await waitFor(() => accessed);
    percy.browser.close();
    await snap;

    expect(logger.stderr).toEqual([
      '[percy] Encountered an error taking snapshot: test snapshot',
      jasmine.stringMatching('Session closed')
    ]);
  });

  it('handles closing during network idle', async () => {
    let accessed;

    server.reply('/img.png', () => new Promise(resolve => {
      setTimeout(resolve, 500, [500, 'text/plain', 'Server Error']);
      accessed = true;
    }));

    let snap = percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      execute: () => {
        document.body.innerHTML += '<img src="/img.png"/>';
      }
    });

    // wait until the asset is requested before exiting
    await waitFor(() => accessed);
    percy.browser.close();
    await snap;

    expect(logger.stderr).toEqual([
      '[percy] Encountered an error taking snapshot: test snapshot',
      jasmine.stringMatching('Network error: Session closed.')
    ]);
  });

  it('handles page crashes', async () => {
    let snap = percy.snapshot({
      name: 'crash snapshot',
      url: 'http://localhost:8000',
      execute: () => new Promise(r => setTimeout(r, 1000))
    });

    await waitFor(() => !!percy.browser.sessions.size);
    let [session] = percy.browser.sessions.values();
    await session.send('Page.crash').catch(() => {});
    await snap;

    expect(logger.stderr).toEqual([
      '[percy] Encountered an error taking snapshot: crash snapshot',
      jasmine.stringMatching('Session crashed!')
    ]);
  });

  describe('without an existing dom snapshot', () => {
    it('navigates to a url and takes a snapshot', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000'
      });

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p>Test</p>');
    });

    it('navigates to a url and takes a snapshot after `waitForTimeout`', async () => {
      testDOM = testDOM.replace('</p>', '</p><script>' + (
        'setTimeout(() => (document.querySelector("p").id = "test"), 500)'
      ) + '</script>');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        waitForTimeout: 600
      });

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="test">Test</p>');
    });

    it('navigates to a url and takes a snapshot after `waitForSelector`', async () => {
      testDOM = testDOM.replace('</p>', '</p><script>' + (
        'setTimeout(() => (document.querySelector("p").id = "test"), 500)'
      ) + '</script>');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        waitForSelector: '#test'
      });

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="test">Test</p>');
    });

    it('navigates to a url and takes a snapshot after `execute`', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: () => (document.querySelector('p').id = 'eval')
      });

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="eval">Test</p>');
    });

    it('navigates to a url and takes additional snapshots', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        additionalSnapshots: [
          { suffix: ' two' },
          { prefix: 'third ' },
          { name: 'test snapshot 4' }
        ]
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: test snapshot',
        '[percy] Snapshot taken: test snapshot two',
        '[percy] Snapshot taken: third test snapshot',
        '[percy] Snapshot taken: test snapshot 4'
      ]));
    });

    it('takes additional snapshots after running each `execute`', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: () => document.querySelector('p').classList.add('eval-1'),
        additionalSnapshots: [
          { suffix: ' 2', execute: () => document.querySelector('p').classList.add('eval-2') },
          { suffix: ' 3', execute: "() => document.querySelector('p').classList.add('eval-3')" },
          { suffix: ' 4', execute: "document.querySelector('p').classList.add('eval-4')" },
          { suffix: ' 5' }
        ]
      });

      await percy.idle();

      let dom = i => Buffer.from((
        api.requests['/builds/123/resources'][i * 2]
          .body.data.attributes['base64-content']
      ), 'base64').toString();

      expect(dom(0)).toMatch('<p class="eval-1">Test</p>');
      expect(dom(1)).toMatch('<p class="eval-1 eval-2">Test</p>');
      expect(dom(2)).toMatch('<p class="eval-1 eval-2 eval-3">Test</p>');
      expect(dom(3)).toMatch('<p class="eval-1 eval-2 eval-3 eval-4">Test</p>');
      expect(dom(3)).toMatch('<p class="eval-1 eval-2 eval-3 eval-4">Test</p>');
    });

    it('can successfully snapshot a page after executing page navigation', async () => {
      testDOM += '<a href="/foo">Foo</a>';

      await percy.snapshot({
        name: 'foo snapshot',
        url: 'http://localhost:8000',
        execute: () => document.querySelector('a').click()
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toContain(
        '[percy] Snapshot taken: foo snapshot'
      );

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p>Foo</p>');
    });

    it('accepts a function body string to execute', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: dedent`
          let $p = document.querySelector('p');
          setTimeout(() => ($p.id = 'timed'), 100);
          await waitFor(() => $p.id === 'timed', 200);
        `
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toContain(
        '[percy] Snapshot taken: test snapshot'
      );

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="timed">Test</p>');
    });

    it('runs the execute callback in the correct frame', async () => {
      await percy.snapshot({
        name: 'framed snapshot',
        url: 'http://localhost:8000/framed',
        execute() {
          let $p = document.querySelector('p');
          if ($p) $p.id = 'framed';

          let $f = document.querySelector('iframe');
          if ($f) $f.src = '/foo';
        }
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toContain(
        '[percy] Snapshot taken: framed snapshot'
      );

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch(/<iframe.*srcdoc=".*<p>Foo<\/p>/);
    });

    it('errors if execute cannot be serialized', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: 'function () => "parse this"'
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Encountered an error taking snapshot: test snapshot',
        '[percy] Error: The provided function is not serializable'
      ]));
    });

    it('logs execute errors and does not snapshot', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute() {
          throw new Error('test error');
        }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Encountered an error taking snapshot: test snapshot',
        '[percy] Error: test error\n' +
          '    at execute (<anonymous>:4:17)\n' +
          '    at withPercyHelpers (<anonymous>:5:11)'
      ]));
    });

    it('can execute multiple scripts', async () => {
      let dot = () => (document.querySelector('p').innerHTML += '.');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: [dot, dot, dot]
      });

      await percy.idle();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: test snapshot'
      ]);

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p>Test...</p>');
    });

    it('can execute scripts at various states', async () => {
      let domtest = (pre, fn) => `
        let p = document.createElement('p');
        p.innerHTML = ['${pre}', (${fn})()].join(' - ');
        document.body.appendChild(p);
      `;

      await percy.snapshot({
        name: 'foo snapshot',
        url: 'http://localhost:8000',
        widths: [400, 800, 1200],
        execute: {
          afterNavigation: domtest('afterNavigation', () => window.location.href),
          beforeSnapshot: domtest('beforeSnapshot', () => 'done!')
        }
      });

      await percy.snapshot({
        name: 'bar snapshot',
        url: 'http://localhost:8000',
        widths: [400, 800, 1200],
        execute: {
          beforeResize: domtest('beforeResize', () => window.innerWidth),
          afterResize: domtest('afterResize', () => window.innerWidth)
        }
      });

      await percy.idle();

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: foo snapshot',
        '[percy] Snapshot taken: bar snapshot'
      ]);

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch([
        '<p>afterNavigation - http://localhost:8000/</p>',
        '<p>beforeSnapshot - done!</p>'
      ].join(''));

      expect(Buffer.from((
        api.requests['/builds/123/resources'][2]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch([
        '<p>beforeResize - 400</p>',
        '<p>afterResize - 800</p>',
        '<p>beforeResize - 800</p>',
        '<p>afterResize - 1200</p>'
      ].join(''));
    });

    it('can execute scripts with built-in helpers', async () => {
      let helpers = [
        // separately tested via coverage or unit tests
        'config', 'snapshot', 'generatePromise', 'yieldFor', 'waitFor',
        'waitForTimeout', 'waitForSelector', 'waitForXPath', 'scrollToBottom'
      ];

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: helpers.reduce((exec, helper) => exec + (
          `if (!${helper}) throw new Error('Missing ${helper}');\n`
        ), '\n')
      });

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: test snapshot'
      ]);
    });

    it('can execute scripts that wait for specific states', async () => {
      testDOM = '<body><script>document.body.classList.add("ready")</script></body>';

      await percy.snapshot([{
        name: 'wait for timeout',
        url: 'http://localhost:8000',
        async execute({ waitForTimeout }) {
          await waitForTimeout(100);
          document.body.innerText = 'wait for timeout';
        }
      }, {
        name: 'wait for selector',
        url: 'http://localhost:8000',
        async execute({ waitForSelector }) {
          await waitForSelector('body.ready', 1000);
          document.body.innerText = 'wait for selector';
        }
      }, {
        name: 'fail for selector',
        url: 'http://localhost:8000',
        async execute({ waitForSelector }) {
          await waitForSelector('body.not-ready', 100);
          document.body.innerText = 'fail for selector';
        }
      }, {
        name: 'wait for xpath',
        url: 'http://localhost:8000',
        async execute({ waitForXPath }) {
          await waitForXPath('//body[contains(@class, "ready")]', 1000);
          document.body.innerText = 'wait for xpath';
        }
      }, {
        name: 'fail for xpath',
        url: 'http://localhost:8000',
        async execute({ waitForXPath }) {
          await waitForXPath('//body[contains(@class, "not-ready")]', 100);
          document.body.innerText = 'fail for xpath';
        }
      }, {
        name: 'wait for callback',
        url: 'http://localhost:8000',
        async execute({ waitForSelector }) {
          await waitFor(() => document.body.classList.contains('ready'), 1000);
          document.body.innerText = 'wait for callback';
        }
      }, {
        name: 'fail for callback',
        url: 'http://localhost:8000',
        async execute({ waitForSelector }) {
          await waitFor(() => Promise.reject(new Error('failed')), 100);
          document.body.innerText = 'fail for callback';
        }
      }]);

      expect(logger.stderr).toEqual([
        '[percy] Encountered an error taking snapshot: fail for selector',
        jasmine.stringMatching('Error: Unable to find: body.not-ready'),
        '[percy] Encountered an error taking snapshot: fail for xpath',
        jasmine.stringMatching('Error: Unable to find: ' + (
          '\\/\\/body\\[contains\\(@class, "not-ready"\\)\\]')),
        '[percy] Encountered an error taking snapshot: fail for callback',
        jasmine.stringMatching('Error: failed')
      ]);
      expect(logger.stdout).toEqual([
        '[percy] Snapshot taken: wait for timeout',
        '[percy] Snapshot taken: wait for selector',
        '[percy] Snapshot taken: wait for xpath',
        '[percy] Snapshot taken: wait for callback'
      ]);

      await percy.idle();

      let html = api.requests['/builds/123/resources'].map(r => (
        Buffer.from(r.body.data.attributes['base64-content'], 'base64')
      ).toString()).filter(s => s.startsWith('<'));

      expect(html[0]).toMatch('wait for timeout');
      expect(html[1]).toMatch('wait for selector');
      expect(html[2]).toMatch('wait for xpath');
      expect(html[3]).toMatch('wait for callback');
    });

    it('can execute scripts that scroll to the bottom of the page', async () => {
      testDOM = '<body style="height:500vh"><style>*{margin:0;padding:0;}</style></body>';

      await percy.snapshot({
        name: 'scroll to bottom',
        url: 'http://localhost:8000',
        minHeight: 1000,
        async execute({ scrollToBottom }) {
          await scrollToBottom((i, pages) => {
            document.body.innerHTML += `<p>${i}/${pages} (${window.scrollY})</p>`;
          });
        }
      });

      await percy.idle();

      expect(Buffer.from((
        api.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch([
        '<p>1/5 \\(1000\\)</p>',
        '<p>2/5 \\(2000\\)</p>',
        '<p>3/5 \\(3000\\)</p>',
        '<p>4/5 \\(4000\\)</p>'
      ].join(''));
    });
  });

  describe('with percy-css', () => {
    let getResourceData = () => (
      api.requests['/builds/123/snapshots'][0].body.data.relationships.resources.data
    ).find(r => r.attributes['resource-url'].endsWith('.css'));

    beforeEach(() => {
      percy.config.snapshot.percyCSS = 'p { color: purple; }';
    });

    it('creates a resource for global percy-css', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000'
      });

      await percy.idle();

      let resource = getResourceData();
      expect(resource.id).toBe(sha256hash('p { color: purple; }'));
      expect(resource.attributes['resource-url'])
        .toMatch(/localhost:8000\/percy-specific\.\d+\.css$/);
    });

    it('creates a resource for per-snapshot percy-css', async () => {
      percy.set({ snapshot: { percyCSS: '' } });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        percyCSS: 'body { color: purple; }'
      });

      await percy.idle();

      let resource = getResourceData();
      expect(resource.id).toBe(sha256hash('body { color: purple; }'));
      expect(resource.attributes['resource-url'])
        .toMatch(/localhost:8000\/percy-specific\.\d+\.css$/);
    });

    it('concatenates global and per-snapshot percy-css', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        percyCSS: 'p { font-size: 2rem; }'
      });

      await percy.idle();

      let resource = getResourceData();
      expect(resource.id)
        .toBe(sha256hash('p { color: purple; }\np { font-size: 2rem; }'));
      expect(resource.attributes['resource-url'])
        .toMatch(/localhost:8000\/percy-specific\.\d+\.css$/);
    });

    it('injects the percy-css resource into the dom snapshot', async () => {
      // should be injected before the closing body tag
      testDOM = `<html><body>${testDOM}</body></html>`;

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();

      let root = api.requests['/builds/123/resources'][0].body.data;
      let cssURL = new URL(getResourceData().attributes['resource-url']);
      let injectedDOM = testDOM.replace('</body>', (
       `<link data-percy-specific-css rel="stylesheet" href="${cssURL.pathname}"/>`
      ) + '</body>');

      expect(root.id).toEqual(sha256hash(injectedDOM));
      expect(root.attributes).toHaveProperty('base64-content', base64encode(injectedDOM));
    });
  });
});
