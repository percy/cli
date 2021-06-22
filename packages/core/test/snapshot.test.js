import { sha256hash, base64encode } from '@percy/client/dist/utils';
import { mockAPI, logger, createTestServer, dedent } from './helpers';
import { waitFor } from '../src/utils';
import Percy from '../src';

describe('Snapshot', () => {
  let percy, server, testDOM;

  beforeEach(async () => {
    logger.mock();

    testDOM = '<p>Test</p>';

    server = await createTestServer({
      default: () => [200, 'text/html', testDOM],
      '/foo': () => [200, 'text/html', '<p>Foo</p>'],
      '/framed': () => [200, 'text/html', '<iframe src="/"/>']
    });

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 },
      server: false
    });

    logger.reset();
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

  it('errors when missing additional snapshot names', async () => {
    expect(() => percy.snapshot({ url: 'http://localhost:8000', additionalSnapshots: [{}] }))
      .toThrowError('Missing additional snapshot name, prefix, or suffix');
  });

  it('errors when providing conflicting options', () => {
    expect(() => percy.snapshot({ url: 'a', domSnapshot: 'b', waitForTimeout: 'c' }))
      .toThrowError('Conflicting options: domSnapshot, waitForTimeout');
    expect(() => percy.snapshot({ url: 'a', domSnapshot: 'b', waitForSelector: 'c' }))
      .toThrowError('Conflicting options: domSnapshot, waitForSelector');
    expect(() => percy.snapshot({ url: 'a', domSnapshot: 'b', execute: 'c' }))
      .toThrowError('Conflicting options: domSnapshot, execute');
    expect(() => percy.snapshot({ url: 'a', domSnapshot: 'b', additionalSnapshots: [] }))
      .toThrowError('Conflicting options: domSnapshot, additionalSnapshots');
  });

  it('warns on deprecated options', () => {
    // close snapshot queues to prevent snapshots from actually being taken
    percy.close();

    // closed queues cause future snapshot invokations to error
    expect(() => percy.snapshot({ url: 'a', requestHeaders: {} })).toThrow();
    expect(() => percy.snapshot({ url: 'b', authorization: {} })).toThrow();
    expect(() => percy.snapshot({ url: 'b', snapshots: [] })).toThrow();

    expect(logger.stderr).toEqual([
      '[percy] Warning: The snapshot option `requestHeaders` ' +
        'will be removed in 1.0.0. Use `discovery.requestHeaders` instead.',
      '[percy] Warning: The snapshot option `authorization` ' +
        'will be removed in 1.0.0. Use `discovery.authorization` instead.',
      '[percy] Warning: The `snapshots` option ' +
        'will be removed in 1.0.0. Use `additionalSnapshots` instead.'
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

  it('errors if parameters are invalid', async () => {
    testDOM += '<style href="/404-cov.css"/>';

    await percy.snapshot({
      name: 'invalid snapshot',
      url: 'http://localhost:8000',
      widths: ['not-a-width']
    });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Encountered an error taking snapshot: invalid snapshot',
      '[percy] Error: Protocol error (Emulation.setDeviceMetricsOverride): ' +
        'Invalid parameters: Failed to deserialize params.width ' +
        '- BINDINGS: int32 value expected at position 50'
    ]));
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
    mockAPI.reply('/builds/123/snapshots', () => [401, {
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

  it('handles the browser closing early', async () => {
    spyOn(percy.browser, 'page').and.callThrough();

    let snap = percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    // wait until a page is requested
    await waitFor(() => percy.browser.page.calls.any());
    percy.browser.close();
    await snap;

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
      jasmine.stringMatching('Page closed')
    ]);
  });

  it('handles closing during network idle', async () => {
    let accessed;

    server.reply('/img.png', () => new Promise(resolve => {
      setTimeout(() => (accessed = true), 100);
      setTimeout(resolve, 500, [500, 'text/plain', 'Server Error']);
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
      jasmine.stringMatching('Network error: Page closed')
    ]);
  });

  it('handles page crashes', async () => {
    let snap = percy.snapshot({
      name: 'crash snapshot',
      url: 'http://localhost:8000',
      execute: () => new Promise(r => setTimeout(r, 1000))
    });

    // wait for page creation
    await new Promise(r => setTimeout(r, 500));
    let [[, page]] = percy.browser.pages;
    await page.send('Page.crash').catch(() => {});
    await snap;

    expect(logger.stderr).toEqual([
      '[percy] Encountered an error taking snapshot: crash snapshot',
      jasmine.stringMatching('Page crashed!')
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
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
          '    at execute (<anonymous>:2:17)\n' +
          '    at withPercyHelpers (<anonymous>:3:11)'
      ]));
    });
  });

  describe('with percy-css', () => {
    let getResourceData = () => (
      mockAPI.requests['/builds/123/snapshots'][0]
        .body.data.relationships.resources.data);

    beforeEach(() => {
      percy.config.snapshot.percyCSS = 'p { color: purple; }';
    });

    it('creates a resource for global percy-css', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000'
      });

      await percy.idle();

      let resources = getResourceData();
      expect(resources[1].id).toBe(sha256hash('p { color: purple; }'));
      expect(resources[1].attributes['resource-url'])
        .toMatch(/localhost:8000\/percy-specific\.\d+\.css$/);
    });

    it('creates a resource for per-snapshot percy-css', async () => {
      percy.config.snapshot.percyCSS = '';

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        percyCSS: 'body { color: purple; }'
      });

      await percy.idle();

      let resources = getResourceData();
      expect(resources[1].id).toBe(sha256hash('body { color: purple; }'));
      expect(resources[1].attributes['resource-url'])
        .toMatch(/localhost:8000\/percy-specific\.\d+\.css$/);
    });

    it('concatenates global and per-snapshot percy-css', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        percyCSS: 'p { font-size: 2rem; }'
      });

      await percy.idle();

      let resources = getResourceData();
      expect(resources[1].id)
        .toBe(sha256hash('p { color: purple; }\np { font-size: 2rem; }'));
      expect(resources[1].attributes['resource-url'])
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

      let root = mockAPI.requests['/builds/123/resources'][0].body.data;
      let cssURL = new URL(getResourceData()[1].attributes['resource-url']);
      let injectedDOM = testDOM.replace('</body>', (
       `<link data-percy-specific-css rel="stylesheet" href="${cssURL.pathname}"/>`
      ) + '</body>');

      expect(root.id).toEqual(sha256hash(injectedDOM));
      expect(root.attributes).toHaveProperty('base64-content', base64encode(injectedDOM));
    });
  });
});
