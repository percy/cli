import { sha256hash } from '@percy/client/utils';
import { logger, api, setupTest, createTestServer, dedent } from './helpers/index.js';
import Percy from '@percy/core';
import { RESOURCE_CACHE_KEY } from '../src/discovery.js';
import Session from '../src/session.js';

describe('Discovery', () => {
  let percy, server, captured;

  const testDOM = dedent`
    <html>
    <head><link href="style.css" rel="stylesheet"/></head>
    <body>
      <p>Hello Percy!<p><img src="img.gif" decoding="async"/>
      ${' '.repeat(1000)}
    </body>
    </html>
  `;

  const testCSS = dedent`
    p { color: purple; }
  `;

  // http://png-pixel.com/
  const pixel = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

  beforeEach(async () => {
    captured = [];
    await setupTest();
    delete process.env.PERCY_BROWSER_EXECUTABLE;

    api.reply('/builds/123/snapshots', ({ body }) => {
      // resource order is not important, stabilize it for testing
      captured.push(body.data.relationships.resources.data.sort((a, b) => (
        a.attributes['resource-url'].localeCompare(b.attributes['resource-url'])
      )));

      return [201, { data: { id: '4567' } }];
    });

    server = await createTestServer({
      '/': () => [200, 'text/html', testDOM],
      '/style.css': () => [200, 'text/css', testCSS],
      '/img.gif': () => [200, 'image/gif', pixel],
      '/font.woff': () => [200, 'font/woff', '<font>']
    });

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      snapshot: { widths: [1000] },
      discovery: { concurrency: 1 }
    });
  });

  afterEach(async () => {
    await percy?.stop(true);
    await server.close();
  });

  it('gathers resources for a snapshot', async () => {
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    await percy.idle();

    let paths = server.requests.map(r => r[0]);
    // does not request the root url (serves domSnapshot instead)
    expect(paths).not.toContain('/');
    expect(paths).toContain('/style.css');
    expect(paths).toContain('/img.gif');

    expect(captured[0]).toEqual([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(testDOM),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/'
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(pixel),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(testCSS),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/style.css'
        })
      })
    ]);
  });

  it('waits for discovery network idle timeout', async () => {
    percy.set({ discovery: { networkIdleTimeout: 400 } });

    server.reply('/', () => [200, 'text/html', dedent`
      <html><body><script>
        let img = document.createElement('img');
        img.src = '/img.gif';
        document.body.appendChild(img);
      </script></body></html>
    `]);

    await percy.snapshot({
      widths: [500],
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    await percy.idle();

    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/img.gif');

    expect(captured[0]).toContain(
      jasmine.objectContaining({
        id: sha256hash(pixel),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      })
    );
  });

  it('captures stylesheet initiated fonts', async () => {
    server.reply('/style.css', () => [200, 'text/css', [
      '@font-face { font-family: "test"; src: url("/font.woff") format("woff"); }',
      'body { font-family: "test", "sans-serif"; }'
    ].join('')]);

    await percy.snapshot({
      name: 'font snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/font.woff');

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        id: sha256hash('<font>'),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/font.woff'
        })
      })
    ]));
  });

  it('captures redirected resources', async () => {
    let stylesheet = [
      '@font-face { font-family: "test"; src: url("/font-file.woff") format("woff"); }',
      'body { font-family: "test", "sans-serif"; }'
    ].join('');

    server.reply('/style.css', () => [200, 'text/css', stylesheet]);
    server.reply('/stylesheet.css', () => [301, { Location: '/style.css' }]);
    server.reply('/font-file.woff', () => [301, { Location: '/font.woff' }]);

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM.replace('style.css', 'stylesheet.css')
    });

    await percy.idle();

    expect(server.requests.map(r => r[0]))
      .toEqual(jasmine.arrayContaining([
        '/stylesheet.css',
        '/style.css',
        '/font-file.woff',
        '/font.woff'
      ]));

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        id: sha256hash(stylesheet),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/stylesheet.css'
        })
      }),
      jasmine.objectContaining({
        id: sha256hash('<font>'),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/font-file.woff'
        })
      })
    ]));
  });

  it('waits for async requests', async () => {
    server.reply('/img.gif', () => new Promise(resolve => {
      setTimeout(resolve, 500, [200, 'image/gif', pixel]);
    }));

    let testAsyncDOM = testDOM.replace('<img', '<img loading="lazy"');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testAsyncDOM
    });

    await percy.idle();

    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/img.gif');

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        id: sha256hash(pixel),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      })
    ]));
  });

  it('does not capture prefetch requests', async () => {
    let prefetchDOM = testDOM.replace('stylesheet', 'prefetch');
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: prefetchDOM
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/style.css');

    expect(captured[0]).toEqual([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(prefetchDOM),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/'
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(pixel),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      })
    ]);

    expect(logger.stderr).toContain(
      '[percy:core:discovery] - Skipping empty response'
    );
  });

  it('does not capture data url requests', async () => {
    let dataUrl = `data:image/gif;base64,${pixel.toString('base64')}`;
    let dataUrlDOM = testDOM.replace('img.gif', dataUrl);

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: dataUrlDOM
    });

    await percy.idle();

    expect(captured[0]).not.toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': dataUrl.replace('data:', 'data://')
        })
      })
    ]));
  });

  it('does not capture event-stream requests', async () => {
    let eventStreamDOM = dedent`<!DOCTYPE html><html><head></head><body><script>
      new EventSource('/event-stream').onmessage = event => {
        let p = document.createElement('p');
        p.textContent = event.data;
        document.body.appendChild(p);
      };
    </script></body></html>`;

    server.reply('/events', () => [200, 'text/html', eventStreamDOM]);
    server.route('/event-stream', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // network idle should wait for the first event, so delay it to make sure
      setTimeout(() => res.write('data: This came from a server-sent event\n\n'), 1000);
    });

    await percy.snapshot({
      name: 'test event snapshot',
      url: 'http://localhost:8000/events',
      enableJavaScript: true,
      disableShadowDOM: true
    });

    await percy.idle();

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        // the dom should have been captured after the first event
        id: sha256hash(eventStreamDOM.replace('</body>', (
          '<p>This came from a server-sent event</p></body>'))),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/events'
        })
      })
    ]));

    // the event stream request is not captured
    expect(captured[0]).not.toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/event-stream'
        })
      })
    ]));
  });

  it('does not capture resources with a disallowed status', async () => {
    server.reply('/style.css', () => [202, 'text/css', testCSS]);
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/style.css');

    expect(captured).not.toContain(jasmine.arrayContaining([
      jasmine.objectContaining({
        id: sha256hash(testCSS),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/style.css'
        })
      })
    ]));

    expect(logger.stderr).toContain(
      '[percy:core:discovery] - Skipping disallowed status [202]'
    );
  });

  it('infers mime type when the CDP response mimetype is text/plain', async () => {
    server.reply('/style.css', () => [200, 'text/plain', testCSS]);
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/style.css');

    expect(logger.stderr).toContain(
      '[percy:core:discovery] - mimetype: text/css'
    );
  });

  describe('when response mime is application/octate-stream for a font file', () => {
    it('fetches font file correctly with makeDirect', async () => {
      // add font to page via stylesheet
      server.reply('/style.css', () => [200, 'text/css', [
        '@font-face { font-family: "test"; src: url("/font.woff?abc=1") format("woff"); }',
        'body { font-family: "test", "sans-serif"; }'
      ].join('')]);

      server.reply('/font.woff?abc=1', () => {
        return [200, 'application/octate-stream', '<font>'];
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      // confirm that request was made 2 times, once via browser and once due to makeDirectRequest
      let paths = server.requests.map(r => r[0]);
      expect(paths.filter(x => x === '/font.woff?abc=1').length).toEqual(2);

      let requestData = captured[0].map((x) => x.attributes)
        .filter(x => x['resource-url'] === 'http://localhost:8000/font.woff?abc=1')[0];

      // confirm that original response mimetype is not tampered
      expect(requestData.mimetype).toEqual('application/octate-stream');
    });
  });

  it('does not mimetype parse resource with no file extension', async () => {
    let brokeDOM = testDOM.replace('style.css', 'broken-css');
    server.reply('/broken-css', () => [200, 'text/plain', testCSS]);
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: brokeDOM
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/broken-css');

    expect(logger.stderr).toContain(
      '[percy:core:discovery] - mimetype: text/plain'
    );
  });

  it('does not capture large files', async () => {
    server.reply('/large.css', () => [200, 'text/css', 'A'.repeat(30_000_000)]);
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM.replace('style.css', 'large.css')
    });

    await percy.idle();

    expect(captured[0]).toEqual([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
        })
      }),
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/'
        })
      }),
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      })
    ]);

    expect(logger.stderr).toContain(
      '[percy:core:discovery] - Skipping resource larger than 25MB'
    );
  });

  it('does not capture duplicate root resources', async () => {
    let reDOM = dedent`
      <html><head></head><body>
      <link rel="canonical" href="http://localhost:8000/">
      <p>This isn't honey, Pooh. It's recursion!</p>
      </body></html>
    `;

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: reDOM,
      discovery: {
        // ensure root is requested from discovery
        disableCache: true
      }
    });

    await percy.idle();

    expect(captured[0]).toEqual([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
        })
      }),
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/',
          'is-root': true
        })
      })
    ]);
  });

  it('does not capture script or XHR requests when javascript is not enabled', async () => {
    server.reply('/test.json', () => [200, 'application/json', {}]);
    server.reply('/script.js', () => [200, 'text/javascript', 'fetch("/test.json")']);
    server.reply('/', () => [200, 'text/html', dedent`
      <html><head></head><body>
      <script src="/script.js"></script>
      </body></html>
    `]);

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    await percy.idle();

    expect(server.requests.map(r => r[0]))
      .toEqual(['/', '/script.js', '/test.json']);

    expect(captured[0]).not.toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/test.json'
        })
      }),
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/script.js'
        })
      })
    ]));
  });

  it('logs detailed debug logs', async () => {
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM,
      widths: [400, 1200]
    });

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy:core] Snapshot taken: test snapshot'
    ]));

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:page] Page created',
      '[percy:core:page] Resize page to 400x1024 @1x',
      '[percy:core:page] Navigate to: http://localhost:8000/',
      '[percy:core:discovery] Handling request: http://localhost:8000/',
      '[percy:core:discovery] - Serving root resource',
      '[percy:core:discovery] Handling request: http://localhost:8000/style.css',
      '[percy:core:discovery] Handling request: http://localhost:8000/img.gif',
      '[percy:core:discovery] Processing resource: http://localhost:8000/style.css',
      `[percy:core:discovery] - sha: ${sha256hash(testCSS)}`,
      '[percy:core:discovery] - mimetype: text/css',
      '[percy:core:discovery] Processing resource: http://localhost:8000/img.gif',
      `[percy:core:discovery] - sha: ${sha256hash(pixel)}`,
      '[percy:core:discovery] - mimetype: image/gif',
      '[percy:core:page] Page navigated',
      '[percy:core:discovery] Wait for 100ms idle',
      '[percy:core:page] Resize page to 1200x1024 @1x',
      '[percy:core:discovery] Wait for 100ms idle',
      '[percy:core:page] Page closed'
    ]));
  });

  it('logs failed request errors with a debug loglevel', async () => {
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM.replace('style.css', 'http://localhost:404/style.css')
    });
    // with an unknown port number, we should get connection refused error

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy:core] Snapshot taken: test snapshot'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(new RegExp( // eslint-disable-line prefer-regex-literals
        '^\\[percy:core:discovery\\] Request failed for http://localhost:404/style\\.css: net::ERR_CONNECTION_REFUSED'
      ))
    ]));
  });

  it('allows setting a custom discovery user-agent', async () => {
    let userAgent;

    server.reply('/img.gif', req => {
      userAgent = req.headers['user-agent'];
      return [200, 'image/gif', pixel];
    });

    await percy.snapshot({
      name: 'test ua',
      url: 'http://localhost:8000',
      domSnapshot: testDOM,
      discovery: { userAgent: 'fake/ua' }
    });

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Snapshot taken: test ua'
    ]));

    expect(userAgent).toEqual('fake/ua');
  });

  it('captures responsive assets', async () => {
    let responsiveDOM = dedent`
      <html>
      <head><link href="style.css" rel="stylesheet"/></head>
      <body>
        <p>Hello Percy!<p>
        <img srcset="/img-400w.gif 400w, /img-600w.gif 600w, /img-800w.gif 800w"
             sizes="(max-width: 600px) 400px, (max-width: 800px) 600px, 800px"
             src="/img-800w.gif">
      </body>
      </html>
    `;

    let responsiveCSS = dedent`
      body { background: url('/img-bg-1.gif'); }
      @media (max-width: 600px) {
        body { background: url('/img-bg-2.gif'); }
      }
    `;

    server.reply('/', () => [200, 'text/html', responsiveDOM]);
    server.reply('/style.css', () => [200, 'text/css', responsiveCSS]);
    server.reply('/img-400w.gif', () => [200, 'image/gif', pixel]);
    server.reply('/img-600w.gif', () => new Promise(r => (
      setTimeout(r, 200, [200, 'image/gif', pixel]))));
    server.reply('/img-800w.gif', () => [200, 'image/gif', pixel]);
    server.reply('/img-bg-1.gif', () => [200, 'image/gif', pixel]);
    server.reply('/img-bg-2.gif', () => [200, 'image/gif', pixel]);

    await percy.snapshot({
      name: 'test responsive',
      url: 'http://localhost:8000',
      domSnapshot: responsiveDOM,
      widths: [400, 800, 1200]
    });

    await percy.idle();

    let resource = path => jasmine.objectContaining({
      attributes: jasmine.objectContaining({
        'resource-url': `http://localhost:8000${path}`
      })
    });

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      resource('/img-400w.gif'),
      resource('/img-600w.gif'),
      resource('/img-800w.gif'),
      resource('/img-bg-1.gif'),
      resource('/img-bg-2.gif')
    ]));
  });

  describe('devicePixelRatio', () => {
    it('should warn about depreacted option', async () => {
      await percy.snapshot({
        name: 'test responsive',
        url: 'http://localhost:8000',
        discovery: { devicePixelRatio: 2 },
        widths: [400, 800]
      });

      await percy.idle();

      expect(logger.stderr).toContain('[percy:core:discovery] discovery.devicePixelRatio is deprecated percy will now auto capture resource in all devicePixelRatio, Ignoring configuration');
    });
  });

  it('captures requests from workers', async () => {
    // Fetch and Network events are inherently racey because they come from different processes. The
    // bug we are testing here happens specifically when the Network event comes after the Fetch
    // event. Using a stub, we can cause Network events to happen a few milliseconds later than they
    // might, ensuring that they come after Fetch events.
    spyOn(percy.browser, '_handleMessage').and.callFake(function(data) {
      let { method } = JSON.parse(data);

      if (method === 'Network.requestWillBeSent') {
        setTimeout(this._handleMessage.and.originalFn.bind(this), 10, data);
      } else {
        this._handleMessage.and.originalFn.call(this, data);
      }
    });

    server.reply('/worker.js', () => [200, 'text/javascript', dedent`
      self.addEventListener("message", async ({ data }) => {
        let response = await fetch(new Request(data));
        self.postMessage("done");
      })`]);

    server.reply('/', () => [200, 'text/html', dedent`
      <!DOCTYPE html><html><head></head><body><script>
        let worker = new Worker("/worker.js");
        worker.addEventListener("message", ({ data }) => document.body.classList.add(data));
        setTimeout(() => worker.postMessage("http://localhost:8000/img.gif"), 100);
      </script></body></html>`]);

    await percy.snapshot({
      name: 'worker snapshot',
      url: 'http://localhost:8000',
      waitForSelector: '.done',
      enableJavaScript: true
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/img.gif');

    expect(captured).toContain(jasmine.arrayContaining([
      jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      })
    ]));
  });

  it('does not error on cancelled requests', async () => {
    percy.loglevel('debug');

    let url = 'http://localhost:8000/test';
    let doc = dedent`
      <!DOCTYPE html><html><head></head><body><script>
        async function fetchWithTimeout(resource, options = {}) {
          const { timeout = 8000 } = options;
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeout);
          const response = await fetch(resource, {
            ...options,
            signal: controller.signal
          });
          clearTimeout(id);
          return response;
        }
        setTimeout(() => fetchWithTimeout("${url}", { timeout: 50 }), 10);
      </script></body></html>
    `;
    // above request is cancelled in 50ms, and it will not resolve in 50ms as per following
    // mock so we can reproduce browser cancelling the request post requesting it

    spyOn(Session.prototype, 'send').and.callFake(function(method, params) {
      if (method === 'Fetch.continueRequest') {
        this.log.debug(`Got Fetch.continueRequest ${params.requestId}`);
        this.log.debug(`Waiting for request to get aborted ${params.requestId}`);

        // waste 1 sec
        let startTime = new Date().getSeconds();
        while (startTime === new Date().getSeconds()) {
          // waste time
          // We cant use jasmine timer tick here as thats simulated time vs we want to actually
          // wait for 1 sec
          // We are waiting for js fetch call in above doc to get cancelled as we have set timeout
          // of 50ms there
          // Current real time wait would stall the request for a second so that it cant resolve in
          // 50 ms. Allowing us to reproduce the race condition
        }
        // note, while we wait 1 sec on primary page load request as well, that will not get
        // aborted so we are good, even if request is delayed
      }
      return this.send.and.originalFn.call(this, method, params);
    });

    server.reply('/', () => [200, 'text/html', doc]);

    server.reply('/test', () => [200, 'text/plain', 'abc']);

    await percy.snapshot({
      name: 'cancelled request',
      url: 'http://localhost:8000',
      enableJavaScript: true
    });

    await percy.idle();

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy:core] Snapshot taken: cancelled request'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(new RegExp( // eslint-disable-line prefer-regex-literals
        `^\\[percy:core:discovery\\] Request aborted for ${url}: net::ERR_ABORTED`
      )),
      jasmine.stringMatching(new RegExp( // eslint-disable-line prefer-regex-literals
        `^\\[percy:core:discovery\\] Ignoring further steps for ${url} as request was aborted by the browser.`
      ))
    ]));
    expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(new RegExp( // eslint-disable-line prefer-regex-literals
        '^\\[percy:core:discovery\\] Error: Protocol error (Fetch.fulfillRequest): Invalid InterceptionId.'
      ))
    ]));
  });

  it('can skip asset discovery', async () => {
    // stop current instance to create a new one
    await percy.stop();

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      skipDiscovery: true,
      clientInfo: 'testing',
      environmentInfo: 'testing'
    });

    logger.reset();

    await percy.snapshot({
      name: 'Snapshot with DOM',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    expect(() => percy.snapshot({
      name: 'Snapshot without DOM',
      url: 'http://localhost:8000'
    })).toThrowError(
      'Cannot capture DOM snapshots when asset discovery is disabled'
    );

    await percy.idle();
    expect(server.requests).toEqual([]);

    expect(captured).toHaveSize(1);
    expect(captured[0].map(r => r.attributes['resource-url'])).toEqual([
      jasmine.stringMatching(/\/percy\.\d+\.log$/),
      'http://localhost:8000/'
    ]);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Snapshot taken: Snapshot with DOM'
    ]);
  });

  describe('idle timeout', () => {
    let Network;

    beforeEach(async () => {
      ({ Network } = await import('../src/network.js'));
      Network.TIMEOUT = undefined;
      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = 500;

      // some async request that takes a while
      server.reply('/img.gif', () => new Promise(r => (
        setTimeout(r, 3000, [200, 'image/gif', pixel]))));

      server.reply('/', () => [200, 'text/html', (
        testDOM.replace('<img', ('<img loading="lazy"')))]);
    });

    afterEach(() => {
      Network.TIMEOUT = undefined;
      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = undefined;
    });

    it('throws an error when requests fail to idle in time', async () => {
      await percy.snapshot({
        name: 'test idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(
        '[percy] Error: Timed out waiting for network requests to idle.'
      );
    });

    it('shows debug info when requests fail to idle in time', async () => {
      percy.loglevel('debug');

      await percy.snapshot({
        name: 'test idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(jasmine.stringMatching([
        '^\\[percy:core] Error: Timed out waiting for network requests to idle.',
        '',
        '  Active requests:',
        '  - http://localhost:8000/img.gif',
        '',
        '(?<stack>(.|\n)*)$'
      ].join('\n')));
    });

    it('shows a warning when idle wait timeout is set over 60000ms', async () => {
      percy.loglevel('debug');
      process.env.PERCY_NETWORK_IDLE_WAIT_TIMEOUT = 80000;

      await percy.snapshot({
        name: 'test idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(jasmine.stringMatching(
        '^\\[percy:core:discovery] Wait for 100ms idle'
      ));
      expect(logger.stderr).toContain(jasmine.stringMatching(
        '^\\[percy:core:discovery] Setting PERCY_NETWORK_IDLE_WAIT_TIMEOUT over 60000ms is not'
      ));
    });
  });

  describe('navigation timeout', () => {
    let Page;

    beforeEach(async () => {
      ({ Page } = await import('../src/page.js'));
      Page.TIMEOUT = undefined;
      process.env.PERCY_PAGE_LOAD_TIMEOUT = 500;

      server.reply('/', () => [200, 'text/html', testDOM]);
      // trigger navigation fail
      server.reply('/img.gif', () => new Promise(r => (
        setTimeout(r, 3000, [200, 'image/gif', pixel]))));
    });

    afterEach(() => {
      Page.TIMEOUT = undefined;
      process.env.PERCY_PAGE_LOAD_TIMEOUT = undefined;
    });

    it('shows debug info when navigation fails within the timeout', async () => {
      percy.loglevel('debug');

      await percy.snapshot({
        name: 'navigation idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(jasmine.stringMatching([
        '^\\[percy:core] Error: Navigation failed: Timed out waiting for the page load event',
        '',
        '  Active requests:',
        '  - http://localhost:8000/img.gif',
        '',
        '(?<stack>(.|\n)*)$'
      ].join('\n')));
    });

    it('shows a warning when page load timeout is set over 60000ms', async () => {
      percy.loglevel('debug');
      process.env.PERCY_PAGE_LOAD_TIMEOUT = 80000;

      await percy.snapshot({
        name: 'navigation idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(jasmine.stringMatching(
        '^\\[percy:core:discovery] Wait for 100ms idle'
      ));
      expect(logger.stderr).toContain(jasmine.stringMatching(
        '^\\[percy:core:page] Setting PERCY_PAGE_LOAD_TIMEOUT over 60000ms is not recommended.'
      ));
    });
  });

  describe('cookies', () => {
    let cookie;

    async function startWithCookies(cookies) {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { cookies, concurrency: 1 }
      });
    }

    beforeEach(async () => {
      cookie = null;

      server.reply('/img.gif', req => {
        cookie = req.headers.cookie;
        return [200, 'image/gif', pixel];
      });
    });

    it('gets sent for all requests', async () => {
      // test cookie object
      await startWithCookies({
        sugar: '123456',
        raisin: '456789'
      });

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual('sugar=123456; raisin=456789');
    });

    it('can be sent for certain requests', async () => {
      // test cookie array
      await startWithCookies([{
        name: 'chocolate',
        value: '654321'
      }, {
        name: 'shortbread',
        value: '987654',
        // not the snapshot url
        url: 'http://example.com/'
      }]);

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual('chocolate=654321');
    });
  });

  describe('protected resources', () => {
    let authDOM = testDOM.replace('img.gif', 'auth/img.gif');

    beforeEach(() => {
      server.reply('/auth/img.gif', ({ headers: { authorization } }) => {
        if (authorization === 'Basic dGVzdDo=') {
          return [200, 'image/gif', pixel];
        } else {
          return [401, {
            'WWW-Authenticate': 'Basic',
            'Content-Type': 'text/plain'
          }, '401 Unauthorized'];
        }
      });
    });

    it('captures with valid auth credentials', async () => {
      await percy.snapshot({
        name: 'auth snapshot',
        url: 'http://localhost:8000/auth',
        domSnapshot: authDOM,
        discovery: {
          authorization: { username: 'test' }
        }
      });

      await percy.idle();

      expect(captured[0]).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/auth/img.gif'
          })
        })
      ]));
    });

    it('captures fonts with valid basic auth header credentials', async () => {
      percy.loglevel('debug');

      const fontAuthDOM = dedent`
        <html>
        <head>
          <style>
           @font-face { font-family: "test"; src: url("font-auth/font.woff") format("woff"); }
           body { font-family: "test", "sans-serif"; }
          </style>
        </head>
        <body>
          <p>Hello Percy!<p>
          ${' '.repeat(1000)}
        </body>
        </html>
      `;

      server.reply('/font-auth/font.woff', ({ headers: { authorization } }) => {
        if (authorization === 'Basic dGVzdDo=') {
          return [200, 'font/woff', '<font>'];
        } else {
          return [401, {
            'WWW-Authenticate': 'Basic',
            'Content-Type': 'text/plain'
          }, '401 Unauthorized'];
        }
      });

      await percy.snapshot({
        name: 'font auth snapshot',
        url: 'http://localhost:8000/font-auth',
        domSnapshot: fontAuthDOM,
        discovery: {
          requestHeaders: { Authorization: 'Basic dGVzdDo=' }
        }
      });

      await percy.idle();

      expect(logger.stderr).toContain(
        '[percy:core:discovery] - Requesting asset directly'
      );
      expect(captured[0]).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/font-auth/font.woff'
          })
        })
      ]));
    });

    it('captures fonts with valid username basic auth', async () => {
      percy.loglevel('debug');

      const fontAuthDOM = dedent`
        <html>
        <head>
          <style>
           @font-face { font-family: "test"; src: url("font-auth/font.woff") format("woff"); }
           body { font-family: "test", "sans-serif"; }
          </style>
        </head>
        <body>
          <p>Hello Percy!<p>
          ${' '.repeat(1000)}
        </body>
        </html>
      `;

      server.reply('/font-auth/font.woff', ({ headers: { authorization } }) => {
        if (authorization === 'Basic dGVzdDo=') {
          return [200, 'font/woff', '<font>'];
        } else {
          return [401, {
            'WWW-Authenticate': 'Basic',
            'Content-Type': 'text/plain'
          }, '401 Unauthorized'];
        }
      });

      await percy.snapshot({
        name: 'font auth snapshot',
        url: 'http://localhost:8000/font-auth',
        domSnapshot: fontAuthDOM,
        discovery: {
          authorization: { username: 'test' }
        }
      });

      await percy.idle();

      expect(logger.stderr).toContain(
        '[percy:core:discovery] - Requesting asset directly'
      );
      expect(captured[0]).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/font-auth/font.woff'
          })
        })
      ]));
    });

    it('captures fonts with valid username & password basic auth', async () => {
      percy.loglevel('debug');

      const fontAuthDOM = dedent`
        <html>
        <head>
          <style>
           @font-face { font-family: "test"; src: url("font-auth/font.woff") format("woff"); }
           body { font-family: "test", "sans-serif"; }
          </style>
        </head>
        <body>
          <p>Hello Percy!<p>
          ${' '.repeat(1000)}
        </body>
        </html>
      `;

      server.reply('/font-auth/font.woff', ({ headers: { authorization } }) => {
        if (authorization === 'Basic dGVzdDp0ZXN0ZXJzb24=') {
          return [200, 'font/woff', '<font>'];
        } else {
          return [401, {
            'WWW-Authenticate': 'Basic',
            'Content-Type': 'text/plain'
          }, '401 Unauthorized'];
        }
      });

      await percy.snapshot({
        name: 'font auth snapshot',
        url: 'http://localhost:8000/font-auth',
        domSnapshot: fontAuthDOM,
        discovery: {
          authorization: { username: 'test', password: 'testerson' }
        }
      });

      await percy.idle();

      expect(logger.stderr).toContain(
        '[percy:core:discovery] - Requesting asset directly'
      );
      expect(captured[0]).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/font-auth/font.woff'
          })
        })
      ]));
    });

    it('does not capture without auth credentials', async () => {
      await percy.snapshot({
        name: 'auth snapshot',
        url: 'http://localhost:8000/auth',
        domSnapshot: authDOM
      });

      await percy.idle();

      expect(captured[0]).not.toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/auth/img.gif'
          })
        })
      ]));
    });

    it('does not capture with invalid auth credentials', async () => {
      await percy.snapshot({
        name: 'auth snapshot',
        url: 'http://localhost:8000/auth',
        domSnapshot: authDOM,
        discovery: {
          authorization: { username: 'invalid' }
        }
      });

      await percy.idle();

      expect(captured[0]).not.toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/auth/img.gif'
          })
        })
      ]));
    });
  });

  describe('resource caching', () => {
    let snapshot = async n => {
      await percy.snapshot({
        name: `test snapshot ${n}`,
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
    };

    it('caches resource requests', async () => {
      // take two snapshots
      await snapshot(1);
      await snapshot(2);

      // only one request for each resource should be made
      let paths = server.requests.map(r => r[0]);
      expect(paths.sort()).toEqual(['/img.gif', '/style.css']);

      // both snapshots' captured resources should match
      // the first captured resource is the log file which is dynamic
      expect(captured[0][1]).toEqual(captured[1][1]);
      expect(captured[0][2]).toEqual(captured[1][2]);
      expect(captured[0][3]).toEqual(captured[1][3]);
    });

    it('does not cache resource requests when disabled', async () => {
      percy.config.discovery.disableCache = true;

      // repeat above test
      await snapshot(1);
      await snapshot(2);

      // two requests for each resource should be made (opposite of prev test)
      let paths = server.requests.map(r => r[0]);
      expect(paths.sort()).toEqual(['/img.gif', '/img.gif', '/style.css', '/style.css']);

      // bot snapshots' captured resources should match
      // the first captured resource is the log file which is dynamic
      expect(captured[0][1]).toEqual(captured[1][1]);
      expect(captured[0][2]).toEqual(captured[1][2]);
      expect(captured[0][3]).toEqual(captured[1][3]);
    });

    it('does not cache root resource', async () => {
      await snapshot(1);
      // http://localhost:8000/
      let rootResources = Array.from(percy[RESOURCE_CACHE_KEY].values()).filter(resource => !!resource.root);
      expect(rootResources.length).toEqual(0);
    });

    it('caches non root resources', async () => {
      await snapshot(1);
      // http://localhost:8000/{img.gif,style.css}
      let nonRootResources = Array.from(percy[RESOURCE_CACHE_KEY].values()).filter(resource => !resource.root);
      expect(nonRootResources.length).toEqual(2);
    });
  });

  describe('with resource errors', () => {
    // sabotage this method to trigger unexpected error handling
    async function triggerSessionEventError(event, error) {
      let { Session } = await import('../src/session.js');

      let spy = spyOn(Session.prototype, 'send').and.callFake(function(...args) {
        if (args[0] === event) return Promise.reject(error);
        return spy.and.originalFn.apply(this, args);
      });
    }

    beforeEach(() => {
      percy.loglevel('debug');
    });

    it('logs unhandled request errors gracefully', async () => {
      let err = new Error('some unhandled request error');
      await triggerSessionEventError('Fetch.continueRequest', err);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy:core] Snapshot taken: test snapshot'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:discovery] Encountered an error handling request: http://localhost:8000/style.css',
        `[percy:core:discovery] ${err.stack}`,
        '[percy:core:discovery] Encountered an error handling request: http://localhost:8000/img.gif',
        `[percy:core:discovery] ${err.stack}`
      ]));
    });

    it('logs unhandled response errors gracefully', async () => {
      let err = new Error('some unhandled request error');
      await triggerSessionEventError('Network.getResponseBody', err);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy:core] Snapshot taken: test snapshot'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:discovery] Encountered an error processing resource: http://localhost:8000/style.css',
        `[percy:core:discovery] ${err.stack}`,
        '[percy:core:discovery] Encountered an error processing resource: http://localhost:8000/img.gif',
        `[percy:core:discovery] ${err.stack}`
      ]));
    });
  });

  describe('with remote resources', () => {
    let testExternalDOM = testDOM.replace('img.gif', 'http://ex.localhost:8001/img.gif');
    let server2;

    beforeEach(async () => {
      server2 = await createTestServer({
        '/img.gif': () => [200, 'image/gif', pixel]
      }, 8001);
    });

    afterEach(async () => {
      await server2.close();
    });

    it('does not capture remote resources', async () => {
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM
      });

      await percy.idle();

      let paths = server.requests.map(r => r[0]);
      expect(paths).toContain('/style.css');
      expect(paths).not.toContain('/img.gif');
      let paths2 = server2.requests.map(r => r[0]);
      expect(paths2).toContain('/img.gif');

      expect(captured[0]).toEqual([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/'
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/style.css'
          })
        })
      ]);
    });

    it('does not wait for remote resource requests to idle', async () => {
      let testExternalAsyncDOM = testExternalDOM.replace('<img', '<img loading="lazy"');

      server2.reply('/img.gif', () => new Promise(resolve => {
        // should not resolve within the test timeout
        setTimeout(resolve, jasmine.DEFAULT_TIMEOUT_INTERVAL + 5000, [200, 'image/gif', pixel]);
      }));

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalAsyncDOM,
        // img loading is eager when not enabled which causes the page load event
        // to wait for the eager img request to finish
        enableJavaScript: true
      });

      await percy.idle();

      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );
    });

    it('captures remote resources from allowed hostnames', async () => {
      // stop current instance to create a new one
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        discovery: {
          allowedHostnames: ['ex.localhost']
        }
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      expect(captured[0]).toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );
    });

    it('does not capture resources from disallowed hostnames', async () => {
      // stop current instance to create a new one
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        discovery: {
          disallowedHostnames: ['ex.localhost']
        }
      });

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:snapshot] - discovery.disallowedHostnames: ex.localhost'
      ]));

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:discovery] Handling request: http://ex.localhost:8001/img.gif',
        '[percy:core:discovery] - Skipping disallowed hostname'
      ]));

      expect(captured[0]).toEqual([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/'
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/style.css'
          })
        })
      ]);
    });

    it('ignores root resource URL when passed to disallowedHostnames', async () => {
      // stop current instance to create a new one
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        discovery: {
          disallowedHostnames: ['localhost']
        }
      });

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      expect(captured[0]).toEqual([
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': jasmine.stringMatching(/^\/percy\.\d+\.log$/)
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/'
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/style.css'
          })
        })
      ]);
    });

    it('does not hang waiting for embedded isolated pages', async () => {
      server.reply('/', () => [200, {
        'Content-Type': 'text/html',
        'Origin-Agent-Cluster': '?1' // force page isolation
      }, testDOM]);

      server2.reply('/', () => [200, 'text/html', [
        '<iframe src="http://embed.localhost:8000"></iframe>'
      ].join('\n')]);

      await percy.snapshot({
        name: 'test cors',
        url: 'http://test.localhost:8001'
      });

      await expectAsync(percy.idle()).toBeResolved();
    });

    it('waits to capture resources from isolated pages', async () => {
      server.reply('/', () => [200, {
        'Content-Type': 'text/html',
        'Origin-Agent-Cluster': '?1' // force page isolation
      }, testDOM]);

      server.reply('/img.gif', () => new Promise(resolve => {
        // wait a tad longer than network idle would
        setTimeout(resolve, 200, [200, 'image/gif', pixel]);
      }));

      server2.reply('/', () => [200, 'text/html', [
        '<iframe src="http://embed.localhost:8000"></iframe>'
      ].join('\n')]);

      await percy.snapshot({
        name: 'test cors',
        url: 'http://test.localhost:8001',
        discovery: {
          allowedHostnames: ['embed.localhost']
        }
      });

      await percy.idle();

      expect(captured[0]).toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://embed.localhost:8000/img.gif'
          })
        })
      );
    });
  });

  describe('with launch options', () => {
    beforeEach(async () => {
      await percy.stop(true);
    });

    it('should log an error if a provided executable cannot be found', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          launchOptions: {
            executable: './404',
            args: ['--no-sandbox', '--unknown-flag']
          }
        }
      });

      expect(logger.stderr).toEqual([
        '[percy] Browser executable not found: ./404'
      ]);
    });

    it('can provide an executable via an environment variable', async () => {
      process.env.PERCY_BROWSER_EXECUTABLE = './from-var';

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] }
      });

      expect(logger.stderr).toEqual([
        '[percy] Browser executable not found: ./from-var'
      ]);
    });

    it('should fail to launch if the devtools address is not logged', async () => {
      await expectAsync(Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          launchOptions: {
            args: ['--remote-debugging-port=null']
          }
        }
      })).toBeRejectedWithError(
        /Failed to launch browser/
      );
    });

    it('should fail to launch after the timeout', async () => {
      await expectAsync(Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          launchOptions: {
            timeout: 10 // unreasonable
          }
        }
      })).toBeRejectedWithError(
        /Failed to launch browser\. Timed out after 10ms/
      );
    });
  });

  describe('Asset Discovery Page JS =>', () => {
    beforeEach(() => {
      // global defaults
      percy.config.snapshot.enableJavaScript = false;
      percy.config.snapshot.cliEnableJavaScript = true;
    });

    describe('cli-snapshot =>', () => {
      it('enabled when enableJavascript: false and cliEnableJavaScript: true', async () => {
        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: ''
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: false',
          '[percy:core:snapshot] - cliEnableJavaScript: true',
          '[percy:core:snapshot] - domSnapshot: false',
          '[percy:core] Asset discovery Browser Page enable JS: true'
        ]));
      });

      it('enabled when enableJavascript: true and cliEnableJavaScript: true', async () => {
        percy.config.snapshot.enableJavaScript = true;
        percy.config.snapshot.cliEnableJavaScript = true;

        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: ''
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: true',
          '[percy:core:snapshot] - cliEnableJavaScript: true',
          '[percy:core:snapshot] - domSnapshot: false',
          '[percy:core] Asset discovery Browser Page enable JS: true'
        ]));
      });

      it('enabled when enableJavascript: true and cliEnableJavaScript: false', async () => {
        percy.config.snapshot.enableJavaScript = true;
        percy.config.snapshot.cliEnableJavaScript = false;

        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: ''
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: true',
          '[percy:core:snapshot] - cliEnableJavaScript: false',
          '[percy:core:snapshot] - domSnapshot: false',
          '[percy:core] Asset discovery Browser Page enable JS: true'
        ]));
      });

      it('disabled when enableJavascript: false and cliEnableJavaScript: false', async () => {
        percy.config.snapshot.enableJavaScript = false;
        percy.config.snapshot.cliEnableJavaScript = false;

        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: ''
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: false',
          '[percy:core:snapshot] - cliEnableJavaScript: false',
          '[percy:core:snapshot] - domSnapshot: false',
          '[percy:core] Asset discovery Browser Page enable JS: false'
        ]));
      });
    });

    describe('percySnapshot with cli-exec =>', () => {
      // cliEnableJavaScript has no effect
      it('disabled when enableJavascript: false and cliEnableJavaScript: true', async () => {
        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: false',
          '[percy:core:snapshot] - cliEnableJavaScript: true',
          '[percy:core:snapshot] - domSnapshot: true',
          '[percy:core] Asset discovery Browser Page enable JS: false'
        ]));
      });

      it('enabled when enableJavascript: true and cliEnableJavaScript: true', async () => {
        percy.config.snapshot.enableJavaScript = true;
        percy.config.snapshot.cliEnableJavaScript = true;

        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: true',
          '[percy:core:snapshot] - cliEnableJavaScript: true',
          '[percy:core:snapshot] - domSnapshot: true',
          '[percy:core] Asset discovery Browser Page enable JS: true'
        ]));
      });

      it('enabled when enableJavascript: true and cliEnableJavaScript: false', async () => {
        percy.config.snapshot.enableJavaScript = true;
        percy.config.snapshot.cliEnableJavaScript = false;

        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: true',
          '[percy:core:snapshot] - cliEnableJavaScript: false',
          '[percy:core:snapshot] - domSnapshot: true',
          '[percy:core] Asset discovery Browser Page enable JS: true'
        ]));
      });

      it('disabled when enableJavascript: false and cliEnableJavaScript: false', async () => {
        percy.config.snapshot.enableJavaScript = false;
        percy.config.snapshot.cliEnableJavaScript = false;

        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableJavaScript: false',
          '[percy:core:snapshot] - cliEnableJavaScript: false',
          '[percy:core:snapshot] - domSnapshot: true',
          '[percy:core] Asset discovery Browser Page enable JS: false'
        ]));
      });
    });
  });

  describe('Enable Layout =>', () => {
    describe('cli-snapshot =>', () => {
      it('enable when enableLayout: true', async () => {
        percy.config.snapshot.enableLayout = true;
        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: ''
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableLayout: true'
        ]));
      });
    });

    describe('percySnapshot with cli-exec =>', () => {
      it('enable when enableLayout: true', async () => {
        percy.config.snapshot.enableLayout = true;
        percy.loglevel('debug');

        await percy.snapshot({
          name: 'test snapshot',
          url: 'http://localhost:8000',
          domSnapshot: testDOM
        });

        await percy.idle();

        expect(logger.stderr).toEqual(jasmine.arrayContaining([
          '[percy:core:snapshot] - enableLayout: true'
        ]));
      });
    });
  });

  describe('Service Worker =>', () => {
    it('captures original request', async () => {
      server.reply('/sw.js', () => [200, 'text/javascript', dedent`
      const fetchUpstream = async(request) => {
        return await fetch(request.clone());
      }
      
      self.addEventListener('fetch', (event) => {
        const { request } = event
        event.respondWith(fetchUpstream(request));
      });
      
      self.addEventListener("activate", (event) => {
        event.waitUntil(clients.claim());
      });
      `]);

      server.reply('/app.js', () => [200, 'text/javascript', dedent`
      const registerServiceWorker = async () => {
        await navigator.serviceWorker.register('sw.js',{ scope: './', });
      };
      
      await registerServiceWorker();
      
      // create and insert image element which will be intercepted and resolved by service worker
      // adding a sleep of 1s for service worker to get activated
      await new Promise(r => setTimeout(r, 1000));
      var img = document.createElement('img');
      img.id = 'injected-image';
      img.src = './img.gif';
      document.getElementById('container').appendChild(img);
      `]);

      server.reply('/', () => [200, 'text/html', dedent`
      <!DOCTYPE html><html><head></head><body>
        <div id="container"></div>
        <script type="module" src="app.js"></script>
      </body></html>
      `]);

      await percy.snapshot({
        name: 'first service worker snapshot',
        url: 'http://localhost:8000',
        waitForSelector: '#injected-image',
        discovery: {
          captureMockedServiceWorker: true
        }
      });

      await percy.idle();

      let paths = server.requests.map(r => r[0]);
      expect(paths).toContain('/img.gif');
      expect(captured).toContain(jasmine.arrayContaining([
        jasmine.objectContaining({
          id: sha256hash(pixel),
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/img.gif'
          })
        })
      ]));
    });
  });

  describe('Capture image srcset =>', () => {
    it('make request call to capture resource', async () => {
      let responsiveDOM = dedent`
        <html>
        <head><link href="style.css" rel="stylesheet"/></head>
        <body>
          <p>Hello Percy!<p>
          <img srcset="/img-fromsrcset.png 400w, /img-throwserror.gif 600w, /img-withdifferentcontenttype.gif 800w"
              sizes="(max-width: 600px) 400px, (max-width: 800px) 600px, 800px"
              src="/img-already-captured.png">
        </body>
        </html>
      `;
      server.reply('/img-fromsrcset.png', () => [200, 'image/png', pixel]);
      server.reply('/img-already-captured.png', () => [200, 'image/png', pixel]);
      server.reply('/img-throwserror.gif', () => [404]);
      server.reply('/img-withdifferentcontenttype.gif', () => [200, 'image/gif', pixel]);

      let capturedResource = {
        url: 'http://localhost:8000/img-already-captured.png',
        content: 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
        mimetype: 'image/png'
      };
      await percy.snapshot({
        name: 'test responsive',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: responsiveDOM,
          resources: [capturedResource]
        },
        discovery: {
          captureSrcset: true
        }
      });

      await percy.idle();

      let resource = path => jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': `http://localhost:8000${path}`
        })
      });

      let paths = server.requests.map(r => r[0]);
      expect(paths).toContain('/img-fromsrcset.png');
      expect(paths).toContain('/img-withdifferentcontenttype.gif');
      expect(paths).toContain('/img-throwserror.gif');
      expect(captured[0]).toEqual(jasmine.arrayContaining([
        resource('/img-fromsrcset.png'),
        resource('/img-withdifferentcontenttype.gif')
      ]));
    });

    it('using snapshot command capture srcset', async () => {
      let responsiveDOM = dedent`
        <html>
        <head></head>
        <body>
          <p>Hello Percy!<p>
          <img srcset="/img-fromsrcset.png 2x, /img-throwserror.jpeg 3x, /img-withdifferentcontenttype.gif 4x, https://remote.resource.com/img-shouldnotcaptured.png 5x"
              sizes="(max-width: 600px) 400px, (max-width: 800px) 600px, 800px"
              src="/img-already-captured.png">
        </body>
        </html>
      `;

      server.reply('/', () => [200, 'text/html', responsiveDOM]);
      server.reply('/img-fromsrcset.png', () => [200, 'image/png', pixel]);
      server.reply('/img-already-captured.png', () => [200, 'image/png', pixel]);
      server.reply('/img-throwserror.jpeg', () => [404]);
      server.reply('/img-withdifferentcontenttype.gif', () => [200, 'image/gif', pixel]);

      await percy.snapshot({
        name: 'image srcset',
        url: 'http://localhost:8000',
        widths: [1024],
        discovery: {
          captureSrcset: true
        }
      });

      await percy.idle();

      let resource = path => jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': `http://localhost:8000${path}`
        })
      });

      expect(captured[0]).toEqual(jasmine.arrayContaining([
        resource('/img-fromsrcset.png'),
        resource('/img-withdifferentcontenttype.gif'),
        resource('/img-already-captured.png')
      ]));

      expect(captured[0]).not.toContain(jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'https://remote.resource.com/img-shouldnotcaptured.png'
        })
      }));
    });
  });

  describe('Capture responsive assets =>', () => {
    it('should capture js based assets', async () => {
      api.reply('/device-details?build_id=123', () => [200, { data: [{ width: 375, deviceScaleFactor: 2 }, { width: 390, deviceScaleFactor: 3 }] }]);
      // stop current instance to create a new one
      await percy.stop();
      percy = await Percy.start({
        projectType: 'web',
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });
      let responsiveDOM = dedent`
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
        <h1>Responsive Images Example</h1>
        <img id="responsive-image" src="default.jpg" alt="Responsive Image">
        <script>
            var image = document.getElementById('responsive-image');
            function updateImage() {
              var width = window.innerWidth;
              var dpr = window.devicePixelRatio;
              if (width <= 375 || dpr == 2) {
                image.src = '/small.jpg';
              } else if (width < 1200 || dpr == 3) {
                image.src = '/medium.jpg';
              } else {
                image.src = '/large.jpg';
              }
            }
            window.addEventListener('resize', updateImage);
            window.addEventListener('load', updateImage);
        </script>
        </body>
        </html>
      `;

      server.reply('/', () => [200, 'text/html', responsiveDOM]);
      server.reply('/default.jpg', () => [200, 'image/jpg', pixel]);
      server.reply('/small.jpg', () => [200, 'image/jpg', pixel]);
      server.reply('/medium.jpg', () => [200, 'image/jpg', pixel]);
      server.reply('/large.jpg', () => [200, 'image/jpg', pixel]);

      await percy.snapshot({
        name: 'image srcset',
        url: 'http://localhost:8000',
        widths: [1024]
      });

      await percy.idle();

      let resource = path => jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': `http://localhost:8000${path}`
        })
      });

      expect(captured[0]).toEqual(jasmine.arrayContaining([
        resource('/default.jpg'),
        resource('/small.jpg'),
        resource('/medium.jpg')
      ]));

      expect(captured[0]).not.toContain(jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/large.jpg'
        })
      }));
    });

    it('captures responsive assets srcset + mediaquery', async () => {
      api.reply('/device-details?build_id=123', () => [200,
        {
          data: [
            { width: 280, deviceScaleFactor: 2 }, { width: 600, deviceScaleFactor: 4 },
            { width: 450, deviceScaleFactor: 3 }, { width: 500, deviceScaleFactor: 5 }
          ]
        }]);
      // stop current instance to create a new one
      await percy.stop();
      percy = await Percy.start({
        projectType: 'web',
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });
      let responsiveDOM = dedent`
        <html>
        <head><link href="style.css" rel="stylesheet"/></head>
        <body>
          <p>Hello Percy!<p>
          <img srcset="/img-fromsrcset.png 2x, /img-throwserror.jpeg 3x, /img-withdifferentcontenttype.gif 4x, https://remote.resource.com/img-shouldnotcaptured.png 5x"
              sizes="(max-width: 600px) 400px, (max-width: 800px) 600px, 800px"
              src="/img-already-captured.png">
        </body>
        </html>
      `;

      let responsiveCSS = dedent`
        body { background: url('/img-bg-1.gif'); }
        @media (max-width: 600px) {
          body { background: url('/img-bg-2.gif'); }
        }
      `;

      server.reply('/', () => [200, 'text/html', responsiveDOM]);
      server.reply('/style.css', () => [200, 'text/css', responsiveCSS]);
      server.reply('/img-fromsrcset.png', () => [200, 'image/png', pixel]);
      server.reply('/img-already-captured.png', () => [200, 'image/png', pixel]);
      server.reply('/img-throwserror.jpeg', () => [404]);
      server.reply('/img-withdifferentcontenttype.gif', () => [200, 'image/gif', pixel]);
      server.reply('/img-bg-1.gif', () => [200, 'image/gif', pixel]);
      server.reply('/img-bg-2.gif', () => [200, 'image/gif', pixel]);

      await percy.snapshot({
        name: 'test responsive',
        url: 'http://localhost:8000',
        domSnapshot: responsiveDOM,
        widths: [590]
      });

      await percy.idle();

      let resource = path => jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': `http://localhost:8000${path}`
        })
      });
      expect(captured[0]).toEqual(jasmine.arrayContaining([
        resource('/img-already-captured.png'),
        resource('/img-fromsrcset.png'),
        resource('/img-withdifferentcontenttype.gif'),
        resource('/img-bg-1.gif'),
        resource('/img-bg-2.gif')
      ]));

      expect(captured[0]).not.toContain(jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'https://remote.resource.com/img-shouldnotcaptured.png'
        })
      }));
    });
  });
});
