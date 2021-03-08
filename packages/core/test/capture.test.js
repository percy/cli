import { mockAPI, logger, createTestServer, dedent } from './helpers';
import waitFor from '../src/utils/wait-for';
import Percy from '../src';

describe('Percy Capture', () => {
  let percy, server, testDOM;

  beforeEach(async () => {
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
      concurrency: 1
    });

    logger.clear();
  });

  afterEach(async () => {
    await percy.stop();
    await server?.close();
  });

  it('errors when missing a url', () => {
    expect(() => percy.capture({ name: 'test snapshot' }))
      .toThrowError('Missing URL for test snapshot');
    expect(() => percy.capture({ snapshots: [{ name: 'test snapshot' }] }))
      .toThrowError('Missing URL for snapshots');
  });

  it('errors when missing a name or snapshot names', async () => {
    expect(() => percy.capture({ url: 'http://localhost:8000' }))
      .toThrowError('Missing name for http://localhost:8000');
    expect(() => percy.capture({ url: 'http://localhost:8000', snapshots: [{}] }))
      .toThrowError('Missing name for http://localhost:8000');
  });

  it('navigates to a url and takes a snapshot', async () => {
    await percy.capture({
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

    await percy.capture({
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

    await percy.capture({
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
    await percy.capture({
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

  it('navigates to a url and takes multiple snapshots', async () => {
    await percy.capture({
      url: 'http://localhost:8000',
      snapshots: [
        { name: 'snapshot one' },
        { name: 'snapshot two' }
      ]
    });

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: snapshot one\n',
      '[percy] Snapshot taken: snapshot two\n'
    ]);
  });

  it('navigates to a url and takes additional snapshots', async () => {
    await percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      snapshots: [
        { name: 'test snapshot two' },
        { name: 'test snapshot three' }
      ]
    });

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: test snapshot\n',
      '[percy] Snapshot taken: test snapshot two\n',
      '[percy] Snapshot taken: test snapshot three\n'
    ]);
  });

  it('can successfully snapshot a page after executing page navigation', async () => {
    testDOM += '<a href="/foo">Foo</a>';

    await percy.capture({
      name: 'foo snapshot',
      url: 'http://localhost:8000',
      execute: () => document.querySelector('a').click()
    });

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: foo snapshot\n'
    ]);

    await percy.idle();

    expect(Buffer.from((
      mockAPI.requests['/builds/123/resources'][0]
        .body.data.attributes['base64-content']
    ), 'base64').toString()).toMatch('<p>Foo</p>');
  });

  it('accepts a function body string to execute', async () => {
    await percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      execute: dedent`
        let $p = document.querySelector('p');
        setTimeout(() => ($p.id = 'timed'), 100);
        await waitFor(() => $p.id === 'timed', 200);
      `
    });

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: test snapshot\n'
    ]);

    await percy.idle();

    expect(Buffer.from((
      mockAPI.requests['/builds/123/resources'][0]
        .body.data.attributes['base64-content']
    ), 'base64').toString()).toMatch('<p id="timed">Test</p>');
  });

  it('runs the execute callback in the correct frame', async () => {
    await percy.capture({
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
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: framed snapshot\n'
    ]);

    await percy.idle();

    expect(Buffer.from((
      mockAPI.requests['/builds/123/resources'][0]
        .body.data.attributes['base64-content']
    ), 'base64').toString()).toMatch(/<iframe.*srcdoc=".*<p>Foo<\/p>/);
  });

  it('logs any encountered errors and does not snapshot', async () => {
    await percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      execute() {
        throw new Error('test error');
      }
    });

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Encountered an error for page: http://localhost:8000\n',
      '[percy] Error: test error\n' +
        '    at execute (<anonymous>:2:15)\n' +
        '    at withPercyHelpers (<anonymous>:3:9)\n'
    ]);
  });

  it('errors if execute cannot be serialized', async () => {
    await percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      execute: 'function () => "parse this"'
    });

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Encountered an error for page: http://localhost:8000\n',
      '[percy] Error: The provided function is not serializable\n'
    ]);
  });

  it('errors if the url is invalid', async () => {
    await percy.capture({
      name: 'test snapshot',
      url: 'wat:/localhost:8000'
    });

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Encountered an error for page: wat:/localhost:8000\n',
      '[percy] Error: Navigation failed: net::ERR_ABORTED\n'
    ]);
  });

  it('errors if parameters are invalid', async () => {
    testDOM += '<style href="/404-cov.css"/>';

    await percy.capture({
      name: 'invalid snapshot',
      url: 'http://localhost:8000',
      widths: ['not-a-width']
    });

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Encountered an error taking snapshot: invalid snapshot\n',
      '[percy] Error: Protocol error (Emulation.setDeviceMetricsOverride): ' +
        'Invalid parameters: Failed to deserialize params.width ' +
        '- BINDINGS: int32 value expected at position 50\n'
    ]);
  });

  it('handles the browser closing early', async () => {
    spyOn(percy.discoverer, 'page').and.callThrough();

    let capture = percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    // wait until a page is requested
    await waitFor(() => percy.discoverer.page.calls.any());
    percy.discoverer.close();
    await capture;

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      jasmine.stringMatching('Encountered an error'),
      jasmine.stringMatching('Protocol error \\(Target\\.createTarget\\): Browser closed')
    ]);
  });

  it('handles the page closing early', async () => {
    let accessed = 0;

    testDOM += '<link rel="stylesheet" href="/style.css"/>';
    server.reply('/style.css', () => new Promise(resolve => {
      if (!accessed++) return resolve([200, 'text/css', '']);
      setTimeout(resolve, 500, [200, 'text/css', '']);
    }));

    let capture = percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    // wait until the page has at least loaded in asset discovery before exiting
    await waitFor(() => accessed === 2);
    percy.discoverer.close();
    await capture;

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      jasmine.stringMatching('Encountered an error'),
      jasmine.stringMatching('Navigation failed: Page closed')
    ]);
  });

  it('handles closing during network idle', async () => {
    let accessed;

    server.reply('/img.png', () => new Promise(resolve => {
      setTimeout(() => (accessed = true), 100);
      setTimeout(resolve, 500, [500, 'text/plain', 'Server Error']);
    }));

    let capture = percy.capture({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      execute: () => {
        document.body.innerHTML += '<img src="/img.png"/>';
      }
    });

    // wait until the asset is requested before exiting
    await waitFor(() => accessed);
    percy.discoverer.close();
    await capture;

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      jasmine.stringMatching('Encountered an error'),
      jasmine.stringMatching('Network error: Page closed')
    ]);
  });

  it('handles page crashes', async () => {
    let capture = percy.capture({
      name: 'crash snapshot',
      url: 'http://localhost:8000',
      execute: () => new Promise(r => setTimeout(r, 1000))
    });

    // wait for page creation
    await new Promise(r => setTimeout(r, 500));
    let [[, page]] = percy.discoverer.browser.pages;
    await page.send('Page.crash').catch(() => {});
    await capture;

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      jasmine.stringMatching('Encountered an error'),
      jasmine.stringMatching('Page crashed!')
    ]);
  });
});
