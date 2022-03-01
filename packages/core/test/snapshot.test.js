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
    percy.close(); // close queues so snapshots fail

    expect(() => percy.snapshot({
      url: 'http://foo',
      additionalSnapshots: [{
        waitForTimeout: 1000
      }, {
        name: 'nombre',
        suffix: ' - 1',
        waitForTimeout: 1000
      }]
    })).toThrow();

    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - additionalSnapshots[0]: missing required name, prefix, or suffix',
      '[percy] - additionalSnapshots[1]: prefix & suffix are ignored when a name is provided'
    ]);
  });

  it('warns when providing conflicting options', () => {
    percy.close(); // close queues so snapshots fail

    expect(() => percy.snapshot({
      url: 'http://a',
      domSnapshot: 'b',
      waitForTimeout: 3,
      waitForSelector: 'd',
      execute: 'e',
      additionalSnapshots: [
        { prefix: 'f' }
      ]
    })).toThrow();

    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - additionalSnapshots: not accepted with DOM snapshots',
      '[percy] - waitForTimeout: not accepted with DOM snapshots',
      '[percy] - waitForSelector: not accepted with DOM snapshots',
      '[percy] - execute: not accepted with DOM snapshots'
    ]);
  });

  it('warns if options are invalid', () => {
    percy.close(); // close queues so snapshots fail

    expect(() => percy.snapshot({
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
      }
    })).toThrow();

    expect(logger.stderr).toEqual([
      '[percy] Invalid snapshot options:',
      '[percy] - widths[0]: must be an integer, received a string',
      '[percy] - minHeight: must be <= 2000',
      '[percy] - discovery.allowedHostnames[0]: must not include a protocol',
      '[percy] - discovery.allowedHostnames[1]: must not include a pathname'
    ]);
  });

  it('warns on deprecated options', () => {
    percy.close(); // close queues so snapshots fail

    expect(() => percy.snapshot({ url: 'http://a', requestHeaders: { foo: 'bar' } })).toThrow();
    expect(() => percy.snapshot({ url: 'http://b', authorization: { username: 'foo' } })).toThrow();
    expect(() => percy.snapshot({ url: 'http://c', snapshots: [{ name: 'foobar' }] })).toThrow();

    expect(logger.stderr).toEqual([
      '[percy] Warning: The snapshot option `requestHeaders` ' +
        'will be removed in 1.0.0. Use `discovery.requestHeaders` instead.',
      '[percy] Warning: The snapshot option `authorization` ' +
        'will be removed in 1.0.0. Use `discovery.authorization` instead.',
      '[percy] Warning: The snapshot option `snapshots` ' +
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
      '[percy:core:snapshot] Handling snapshot: test snapshot',
      '[percy:core:snapshot] - url: http://localhost:8000',
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

  it('accepts multiple snapshots', async () => {
    await percy.snapshot([{
      url: 'http://localhost:8000/one',
      domSnapshot: testDOM
    }, {
      url: 'http://localhost:8000/two',
      domSnapshot: testDOM
    }]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: /one',
      '[percy] Snapshot taken: /two'
    ]);
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
      '[percy] Received a duplicate snapshot name, ' +
        'the previous snapshot was canceled: /foobar'
    ]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: /foobar'
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

    it('takes additional snapshots after running each `execute`', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: () => document.querySelector('p').classList.add('eval-1'),
        additionalSnapshots: [
          { suffix: ' 2', execute: () => document.querySelector('p').classList.add('eval-2') },
          { suffix: ' 3', execute: "document.querySelector('p').classList.add('eval-3')" },
          { suffix: ' 4' }
        ]
      });

      await percy.idle();

      let dom = i => Buffer.from((
        mockAPI.requests['/builds/123/resources'][i * 2]
          .body.data.attributes['base64-content']
      ), 'base64').toString();

      expect(dom(0)).toMatch('<p class="eval-1">Test</p>');
      expect(dom(1)).toMatch('<p class="eval-1 eval-2">Test</p>');
      expect(dom(2)).toMatch('<p class="eval-1 eval-2 eval-3">Test</p>');
      expect(dom(3)).toMatch('<p class="eval-1 eval-2 eval-3">Test</p>');
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
          '    at execute (<anonymous>:3:17)\n' +
          '    at withPercyHelpers (<anonymous>:4:11)'
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
        mockAPI.requests['/builds/123/resources'][0]
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
        mockAPI.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch([
        '<p>afterNavigation - http://localhost:8000/</p>',
        '<p>beforeSnapshot - done!</p>'
      ].join(''));

      expect(Buffer.from((
        mockAPI.requests['/builds/123/resources'][2]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch([
        '<p>beforeResize - 400</p>',
        '<p>afterResize - 800</p>',
        '<p>beforeResize - 800</p>',
        '<p>afterResize - 1200</p>'
      ].join(''));
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
