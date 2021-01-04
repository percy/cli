import expect from 'expect';
import Percy from '../src';
import { mockAPI, stdio, createTestServer, dedent } from './helpers';

describe('Percy', () => {
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

    percy.loglevel('info');
  });

  afterEach(async () => {
    percy.loglevel('error');
    await percy.stop();
    await server?.close();
  });

  describe('#capture()', () => {
    it('errors when missing a url', () => {
      expect(() => percy.capture({ name: 'test snapshot' }))
        .toThrow('Missing URL for test snapshot');
      expect(() => percy.capture({ snapshots: [{ name: 'test snapshot' }] }))
        .toThrow('Missing URL for snapshots');
    });

    it('errors when missing a name or snapshot names', async () => {
      expect(() => percy.capture({ url: 'http://localhost:8000' }))
        .toThrow('Missing name for http://localhost:8000');
      expect(() => percy.capture({ url: 'http://localhost:8000', snapshots: [{}] }))
        .toThrow('Missing name for http://localhost:8000');
    });

    it('navigates to a url and takes a snapshot', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000'
      }));

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

      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        waitForTimeout: 600
      }));

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

      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        waitForSelector: '#test'
      }));

      await percy.idle();
      expect(Buffer.from((
        mockAPI.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="test">Test</p>');
    });

    it('navigates to a url and takes a snapshot after `execute`', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: () => (document.querySelector('p').id = 'eval')
      }));

      await percy.idle();
      expect(Buffer.from((
        mockAPI.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="eval">Test</p>');
    });

    it('navigates to a url and takes multiple snapshots', async () => {
      await stdio.capture(() => percy.capture({
        url: 'http://localhost:8000',
        snapshots: [
          { name: 'snapshot one' },
          { name: 'snapshot two' }
        ]
      }));

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: snapshot one\n',
        '[percy] Snapshot taken: snapshot two\n'
      ]);
    });

    it('navigates to a url and takes additional snapshots', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        snapshots: [
          { name: 'test snapshot two' },
          { name: 'test snapshot three' }
        ]
      }));

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: test snapshot\n',
        '[percy] Snapshot taken: test snapshot two\n',
        '[percy] Snapshot taken: test snapshot three\n'
      ]);
    });

    it('can successfully snapshot a page after executing page navigation', async () => {
      testDOM += '<a href="/foo">Foo</a>';

      await stdio.capture(() => percy.capture({
        name: 'foo snapshot',
        url: 'http://localhost:8000',
        execute: () => document.querySelector('a').click()
      }));

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: foo snapshot\n'
      ]);

      await percy.idle();

      expect(Buffer.from((
        mockAPI.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p>Foo</p>');
    });

    it('accepts a function body string to execute', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: dedent`
          let $p = document.querySelector('p');
          setTimeout(() => ($p.id = 'timed'), 100);
          await waitFor(() => $p.id === 'timed', 200);
        `
      }));

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: test snapshot\n'
      ]);

      await percy.idle();

      expect(Buffer.from((
        mockAPI.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch('<p id="timed">Test</p>');
    });

    it('runs the execute callback in the correct frame', async () => {
      await stdio.capture(() => percy.capture({
        name: 'framed snapshot',
        url: 'http://localhost:8000/framed',
        execute() {
          let $p = document.querySelector('p');
          if ($p) $p.id = 'framed';

          let $f = document.querySelector('iframe');
          if ($f) $f.src = '/foo';
        }
      }));

      expect(stdio[2]).toHaveLength(0);
      expect(stdio[1]).toEqual([
        '[percy] Snapshot taken: framed snapshot\n'
      ]);

      await percy.idle();

      expect(Buffer.from((
        mockAPI.requests['/builds/123/resources'][0]
          .body.data.attributes['base64-content']
      ), 'base64').toString()).toMatch(/<iframe.*srcdoc=".*<p>Foo<\/p>/);
    });

    it('logs any encountered errors and does not snapshot', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute() {
          throw new Error('test error');
        }
      }));

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        '[percy] Encountered an error for page: http://localhost:8000\n',
        '[percy] Error: test error\n' +
          '    at execute (<anonymous>:2:17)\n' +
          '    at withPercyHelpers (<anonymous>:3:11)\n'
      ]);
    });

    it('errors if execute cannot be serialized', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        execute: 'function () => "parse this"'
      }));

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        '[percy] Encountered an error for page: http://localhost:8000\n',
        '[percy] Error: The execute function is not serializable\n'
      ]);
    });

    it('errors if the url is invalid', async () => {
      await stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'wat:/localhost:8000'
      }));

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        '[percy] Encountered an error for page: wat:/localhost:8000\n',
        '[percy] Error: Navigation failed: net::ERR_ABORTED\n'
      ]);
    });

    it('errors if parameters are invalid', async () => {
      testDOM += '<style href="/404-cov.css"/>';

      await stdio.capture(() => percy.capture({
        name: 'invalid snapshot',
        url: 'http://localhost:8000',
        widths: ['not-a-width']
      }));

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        '[percy] Encountered an error taking snapshot: invalid snapshot\n',
        '[percy] Error: Protocol error (Emulation.setDeviceMetricsOverride): ' +
          'Invalid parameters width: integer value expected\n'
      ]);
    });

    it('gracefully handles exiting early', async () => {
      // delay an asset so we can interupt it
      testDOM += '<link href="/style.css"/>';
      server.reply('/style.css', () => new Promise(resolve => {
        setTimeout(resolve, 200, [200, 'text/css', '']);
      }));

      let capture = stdio.capture(() => percy.capture({
        name: 'test snapshot',
        url: 'http://localhost:8000'
      }));

      // wait until the page has at least loaded before exiting
      await new Promise(resolve => setTimeout(resolve, 200));
      percy.discoverer.close();
      await capture;

      expect(stdio[1]).toHaveLength(0);
      expect(stdio[2]).toEqual([
        expect.stringMatching('Encountered an error'),
        expect.stringMatching('Page closed')
      ]);
    });
  });
});
