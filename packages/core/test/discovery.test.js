import { sha256hash } from '@percy/client/utils';
import { logger, api, setupTest, createTestServer, dedent, mockRequests } from './helpers/index.js';
import Percy from '@percy/core';
import { RESOURCE_CACHE_KEY } from '../src/discovery.js';
import Session from '../src/session.js';
import Pako from 'pako';
import * as CoreConfig from '@percy/core/config';
import PercyConfig from '@percy/config';

describe('Discovery', () => {
  let percy, server, captured, originalTimeout;

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

  const sharedExpectBlock = (expectedBody) => {
    let lastReq = api.requests['/suggestions/from_logs'].length - 1;
    expect(api.requests['/suggestions/from_logs'][lastReq].body)
      .toEqual(expectedBody);
  };

  beforeEach(async () => {
    captured = [];
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    await setupTest();
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 150000;
    delete process.env.PERCY_BROWSER_EXECUTABLE;
    delete process.env.PERCY_GZIP;

    api.reply('/builds/123/snapshots', ({ body }) => {
      // resource order is not important, stabilize it for testing
      captured.push(body.data.relationships.resources.data.sort((a, b) => (
        a.attributes['resource-url'].localeCompare(b.attributes['resource-url'])
      )));

      return [201, { data: { id: '4567' } }];
    });

    // Mock domain config endpoint - return empty config by default
    api.reply('/projects/domain-config', () => [200, {
      data: {
        type: 'projects',
        id: '123',
        attributes: {}
      }
    }]);

    const dynamicImageRoutes = {};
    for (let i = 0; i < 800; i++) {
      dynamicImageRoutes[`/dynamic/image-${i}.png`] = () => [200, 'image/png', pixel];
    }

    server = await createTestServer({
      '/': () => [200, 'text/html', testDOM],
      '/style.css': () => [200, 'text/css', testCSS],
      '/img.gif': () => [200, 'image/gif', pixel],
      '/font.woff': () => [200, 'font/woff', '<font>'],
      ...dynamicImageRoutes
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
    delete process.env.PERCY_FORCE_PKG_VALUE;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  it('gathers resources for a snapshot in GZIP format', async () => {
    process.env.PERCY_GZIP = true;

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
        id: sha256hash(Pako.gzip(testDOM)),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/'
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(Pako.gzip(pixel)),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/img.gif'
        })
      }),
      jasmine.objectContaining({
        id: sha256hash(Pako.gzip(testCSS)),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/style.css'
        })
      })
    ]);
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

  it('waits for discovery network idle timeout with custom element', async () => {
    percy.set({ discovery: { networkIdleTimeout: 400 } });

    // Mock server response with a custom element
    server.reply('/', () => [200, 'text/html', dedent`
      <html><body>
        <custom-test-element data-test="initial"></custom-test-element>
        <script>
          class CustomElement extends HTMLElement {
            static get observedAttributes() {
              return ['data-test'];
            }

            attributeChangedCallback(name, oldValue, newValue) {
              console.log(\`Attribute \${name} changed from \${oldValue} to \${newValue}\`);
            }
          }

          customElements.define('custom-test-element', CustomElement);

          setTimeout(() => {
            document.querySelector('custom-test-element').setAttribute('data-test', 'updated');
          }, 200);
        </script>
      </body></html>
    `]);

    // Take a Percy snapshot
    await percy.snapshot({
      widths: [500],
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    // Wait for network idle
    await percy.idle();

    // Ensure the server saw the request
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/');
  });

  it('captures custom element with src and waits for network idle', async () => {
    percy.set({ discovery: { networkIdleTimeout: 400 } });

    server.reply('/', () => [200, 'text/html', dedent`
      <html>
        <body>
          <custom-image src="http://localhost:8000/img1.jpg"></custom-image>
          <script>
            class CustomImage extends HTMLElement {
              static get observedAttributes() { return ['src']; }

              constructor() {
                super();
                this.img = document.createElement('img');
                this.attachShadow({ mode: 'open' }).appendChild(this.img);
              }

              attributeChangedCallback(name, oldValue, newValue) {
                if (name === 'src' && newValue && newValue !== oldValue) {
                  console.log('Setting src to:', newValue);
                  if (this.img.src !== newValue) {
                    this.img.src = newValue; // Prevents duplicate requests
                  }
                }
              }
            }

            customElements.define('custom-image', CustomImage);

            // Update src after 200ms
            setTimeout(() => {
              document.querySelector('custom-image').setAttribute('src', 'http://localhost:8000/img2.jpg');
            }, 200);
          </script>
        </body>
      </html>
    `]);

    // Take a Percy snapshot
    await percy.snapshot({
      widths: [500],
      name: 'test snapshot',
      url: 'http://localhost:8000'
    });

    // Wait for network idle
    await percy.idle();

    // Verify requests include images
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/img1.jpg');
    expect(paths).toContain('/img2.jpg');
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
        domSnapshot: {
          html: testDOM,
          cookies: [
            { name: 'abc', value: '123', secure: false, domain: 'localhost' },
            { name: 'abc2', value: '1234', secure: false, domain: 'localhost' },
            { name: 'other', value: '1234', secure: false, domain: 'notlocalhost.com' }
          ]
        }
      });

      await percy.idle();
      // confirm that request was made 2 times, once via browser and once due to makeDirectRequest
      let fontRequests = server.requests.filter(r => r[0] === '/font.woff?abc=1');
      expect(fontRequests.length).toEqual(2);
      // confirm that direct request [ 2nd ] cookies contain correct cookies
      // order of cookies doesnt matter
      expect(['abc=123; abc2=1234', 'abc2=1234; abc=123']).toContain(fontRequests[1][1].cookie);

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

  it('checks if no header is send from server', async () => {
    server.reply('/large.css', () => [200, 'text/css', 'A'.repeat(30_000_000)], { noHeaders: true });
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
      '[percy:core:discovery] - Missing headers for the requested resource.'
    );
  });

  it('does not capture remote files with content-length NAN greater than 25MB', async () => {
    server.reply('/large.css', () => [200, 'text/css', 'A'.repeat(30_000_000)], { headersOverride: { 'content-length': NaN } });
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

  function testContentLengthCasing(description, contentLengthHeader) {
    it(description, async () => {
      server.reply('/large.css', () => [200, 'text/css', 'A'.repeat(30_000_000)], { headersOverride: contentLengthHeader });
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
  }

  describe('Content-Length casing tests', () => {
    testContentLengthCasing('does not capture remote files with content-length casing', { 'content-length': '16515075' });
    testContentLengthCasing('does not capture remote files with Content-Length casing', { 'Content-Length': '16515075' });
    testContentLengthCasing('does not capture remote files with CONTENT-LENGTH casing', { 'CONTENT-LENGTH': '16515075' });
  });

  it('skips file greater than 100MB', async () => {
    server.reply('/large.css', () => [200, 'text/css', 'A'.repeat(100_000_000)]);
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

  describe('asset instrumentation', () => {
    it('logs instrumentation for 5xx errors', async () => {
      server.reply('/error.css', () => [502, 'text/plain', 'Bad Gateway']);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM.replace('style.css', 'error.css'),
        discovery: { disableCache: true }
      });

      await percy.idle();

      const logs = logger.instance.query(log => log.debug === 'core:discovery');
      expect(logs.length).toBeGreaterThan(0, 'No core:discovery logs found');

      const errorLogs = logs.filter(l => l.meta && l.meta.instrumentationCategory === 'asset_load_5xx');
      expect(errorLogs.length).toBeGreaterThan(0, 'No asset_load_5xx logs found');
      expect(errorLogs[0].meta.statusCode).toBe(502);
      expect(errorLogs[0].meta.reason).toBe('server_error');
      expect(errorLogs[0].message).toContain('[ASSET_LOAD_5XX]');
    });

    it('logs instrumentation for resources too large', async () => {
      server.reply('/huge.css', () => [200, 'text/css', 'A'.repeat(30_000_000)]);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM.replace('style.css', 'huge.css')
      });

      await percy.idle();

      const logs = logger.instance.query(log => log.debug === 'core:discovery');
      expect(logs.length).toBeGreaterThan(0, 'No core:discovery logs found');

      const notUploadedLogs = logs.filter(l => l.meta && l.meta.instrumentationCategory === 'asset_not_uploaded');
      const largeLogs = notUploadedLogs.filter(l => l.meta.reason === 'resource_too_large');
      expect(largeLogs.length).toBeGreaterThan(0, 'No resource_too_large logs found');
      expect(largeLogs[0].meta.size).toBeGreaterThan(25000000);
      expect(largeLogs[0].message).toContain('[ASSET_NOT_UPLOADED]');
    });

    it('logs instrumentation for disallowed status codes', async () => {
      server.reply('/notfound.css', () => [404, 'text/plain', 'Not Found']);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM.replace('style.css', 'notfound.css'),
        discovery: { disableCache: true }
      });

      await percy.idle();

      const logs = logger.instance.query(log => log.debug === 'core:discovery');
      expect(logs.length).toBeGreaterThan(0, 'No core:discovery logs found');

      const notUploadedLogs = logs.filter(l => l.meta && l.meta.instrumentationCategory === 'asset_not_uploaded');
      const disallowedLogs = notUploadedLogs.filter(l => l.meta.reason === 'disallowed_status');
      expect(disallowedLogs.length).toBeGreaterThan(0, 'No disallowed_status logs found');
      expect(disallowedLogs[0].meta.statusCode).toBe(404);
      expect(disallowedLogs[0].message).toContain('[ASSET_NOT_UPLOADED]');
    });

    it('logs instrumentation for empty responses', async () => {
      server.reply('/empty.css', () => [200, 'text/css', '']);

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM.replace('style.css', 'empty.css'),
        discovery: { disableCache: true }
      });

      await percy.idle();

      const logs = logger.instance.query(log => log.debug === 'core:discovery');
      expect(logs.length).toBeGreaterThan(0, 'No core:discovery logs found');

      const notUploadedLogs = logs.filter(l => l.meta && l.meta.instrumentationCategory === 'asset_not_uploaded');
      const emptyLogs = notUploadedLogs.filter(l => l.meta && l.meta.reason === 'empty_response');
      expect(emptyLogs.length).toBeGreaterThan(0, 'No empty_response logs found');
      expect(emptyLogs[0].message).toContain('[ASSET_NOT_UPLOADED]');
    });

    it('logs instrumentation for network errors', async () => {
      // Simulate a network error by closing connection without response
      server.reply('/aborted.css', req => {
        req.socket.destroy();
        return null;
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM.replace('style.css', 'aborted.css'),
        discovery: { disableCache: true }
      });

      await percy.idle();

      const logs = logger.instance.query(log => log.debug === 'core:discovery');
      expect(logs.length).toBeGreaterThan(0, 'No core:discovery logs found');

      const missingLogs = logs.filter(l => l.meta && l.meta.instrumentationCategory === 'asset_load_missing');
      expect(missingLogs.length).toBeGreaterThan(0, 'No asset_load_missing logs found');
      expect(missingLogs[0].meta.reason).toBe('network_error');
      expect(missingLogs[0].meta.errorText).toBeDefined();
      expect(missingLogs[0].message).toContain('[ASSET_LOAD_MISSING]');
    });
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

  it('debug error log only for invalid network url', async () => {
    let err = new Error('Some Invalid Error');
    spyOn(global, 'decodeURI').and.callFake((url) => {
      if (url === 'http://localhost:8000/style.css') {
        throw err;
      }
      return url;
    });

    percy.loglevel('debug');
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM
    });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:page] Navigate to: http://localhost:8000/',
      '[percy:core:discovery] Handling request: http://localhost:8000/',
      '[percy:core:discovery] - Serving root resource',
      `[percy:core:discovery] ${err.stack}`,
      '[percy:core:discovery] Handling request: http://localhost:8000/style.css',
      '[percy:core:discovery] Handling request: http://localhost:8000/img.gif'
    ]));
  });

  it('detect invalid network url', async () => {
    percy.loglevel('debug');
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM.replace('style.css', 'http://localhost:404/%style.css')
    });

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core:discovery] Handling request: http://localhost:8000/',
      '[percy:core:discovery] - Serving root resource',
      '[percy:core:discovery] An invalid URL was detected for url: http://localhost:404/%style.css - the snapshot may fail on Percy. Please verify that your asset URL is valid.',
      '[percy:core:discovery] Handling request: http://localhost:404/%style.css',
      '[percy:core:discovery] Handling request: http://localhost:8000/img.gif'
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
    it('should warn about deprecated option', async () => {
      await percy.snapshot({
        name: 'test responsive',
        url: 'http://localhost:8000',
        discovery: { devicePixelRatio: 2 },
        widths: [400, 800]
      });

      await percy.idle();

      expect(logger.stderr).toContain('[percy] Warning: discovery.devicePixelRatio is deprecated percy will now auto capture resource in all devicePixelRatio, Ignoring configuration');
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
      process.env.PERCY_IGNORE_TIMEOUT_ERROR = undefined;
    });

    it('throws an error when requests fail to idle in time', async () => {
      await percy.snapshot({
        name: 'test idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(
        '[percy] Error: Timed out waiting for network requests to idle.'
      );

      let expectedRequestBody = {
        data: {
          logs: [
            {
              message: 'Encountered an error taking snapshot: test idle',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'test idle' } }
            },
            {
              message: 'Timed out waiting for network requests to idle.',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'test idle' } }
            }
          ]
        }
      };
      sharedExpectBlock(expectedRequestBody);
    });

    it('shows debug info when requests fail to idle in time for responsive assets', async () => {
      api.reply('/discovery/device-details?build_id=123', () => [200, { data: [{ width: 375, deviceScaleFactor: 2 }, { width: 390, deviceScaleFactor: 3 }] }]);
      server.reply('/', () => [200, 'text/html', (
        testDOM.replace('<img', ('<img loading="lazy" srcset="/img-fromsrcset.png 2x"'))
      )]);
      server.reply('/img-fromsrcset.png', () => new Promise(r => (
        setTimeout(r, 3000, [200, 'image/gif', pixel]))));
      server.reply('/img.gif', () => new Promise(r => (
        setTimeout(r, 200, [200, 'image/gif', pixel]))));
      await percy.stop();
      percy = await Percy.start({
        projectType: 'web',
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });
      percy.loglevel('debug');

      await percy.snapshot({
        name: 'test idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(jasmine.stringMatching([
        '^\\[percy:core] Error: Timed out waiting for network requests to idle.',
        'While capturing responsive assets try setting PERCY_DO_NOT_CAPTURE_RESPONSIVE_ASSETS to true.',
        '',
        '  Active requests:',
        '  - http://localhost:8000/img-fromsrcset.png',
        '',
        '(?<stack>(.|\n)*)$'
      ].join('\n')));

      sharedExpectBlock({
        data: {
          logs: [
            {
              message: 'Encountered an error taking snapshot: test idle',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'test idle' } }
            },
            {
              message: 'Timed out waiting for network requests to idle.\nWhile capturing responsive assets try setting PERCY_DO_NOT_CAPTURE_RESPONSIVE_ASSETS to true.\n\n  Active requests:\n  - http://localhost:8000/img-fromsrcset.png\n',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'test idle' } }
            }
          ]
        }
      });
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

    it('should not throw error when requests fail to idle in time when PERCY_IGNORE_TIMEOUT_ERROR is true', async () => {
      process.env.PERCY_IGNORE_TIMEOUT_ERROR = 'true';
      await percy.snapshot({
        name: 'test idle',
        url: 'http://localhost:8000'
      });

      expect(logger.stderr).toContain(jasmine.stringMatching(
        '^\\[percy] Ignoring network timeout failures.'
      ));

      expect(logger.stderr).toContain(jasmine.stringMatching(
        '  Active requests:\n' + '  - http://localhost:8000/img.gif\n'
      ));
    });

    describe('with multiple network requests with same url', () => {
      beforeEach(async () => {
        // a custom page where we make 2 requests to same url where only one of them will
        // finish before network idle wait timeout, in such cases we expect to ignore another
        // request stuck in loading state
        server.reply('/', () => [200, 'text/html', dedent`
          <html>
          <body>
            <P>Hello Percy!<p>
            <script>
              // allow page load to fire and then execute this script
              setTimeout(async () => {
                var p1 = fetch('./img.gif');
                var p2 = fetch('./img.gif');
                await p2; // we will resolve second request instantly
                await p1; // we will delay first request by 800ms
              }, 10);
            </script>
          </body>
          </html>`
        ]);
        // trigger responses in expected time
        let counter = 0;
        // we have idle timeout at 500 ms so we are resolving other request at 1 sec
        server.reply('/img.gif', () => new Promise(r => (
          (counter += 1) && setTimeout(r, counter === 2 ? 0 : 1000, [200, 'image/gif', pixel]))));
      });

      it('shows debug info when navigation fails within the timeout', async () => {
        percy.loglevel('debug');

        await percy.snapshot({
          name: 'navigation idle',
          url: 'http://localhost:8000'
        });

        expect(logger.stderr).not.toContain(jasmine.stringMatching([
          '^\\[percy:core] Error: Timed out waiting for network requests to idle.',
          '',
          '  Active requests:',
          '  - http://localhost:8000/img.gif',
          '',
          '(?<stack>(.|\n)*)$'
        ].join('\n')));
      });
    });
  });

  describe('Discovery with resource limit flag', () => {
    const testDOM1 = dedent`
      <html>
        <head>
          <link href="style.css" rel="stylesheet"/>
        </head>
        <body>
          <p>Hello Percy!</p>
          <img src="img.gif" decoding="async"/>
          ${Array.from({ length: 800 }, (_, i) =>
            `<img src="/dynamic/image-${i}.png" />`
          ).join('\n')}
        </body>
      </html>
    `;
    it('limits resources when the flags are set', async () => {
      percy.loglevel('debug');
      process.env.LIMIT_SNAPSHOT_RESOURCES = true;
      process.env.MAX_SNAPSHOT_RESOURCES = 1;
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM1
      });

      await percy.idle();
      expect(captured[0].length).toBeLessThanOrEqual(2); // 1 root + 1 non root
      expect(logger.stderr).toContain(jasmine.stringMatching(/resource limit reached/));
    });

    it('does not limit resources when the limit flag is not set', async () => {
      delete process.env.LIMIT_SNAPSHOT_RESOURCES;
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM1
      });
      await percy.idle();
      expect(captured[0].length).toBeGreaterThanOrEqual(1);
      expect(logger.stderr).not.toContain(jasmine.stringMatching(/resource limit reached/));
      delete process.env.MAX_SNAPSHOT_RESOURCES;
    });

    it('limit resources when flag is set but for default limit', async () => {
      percy.loglevel('debug');
      process.env.LIMIT_SNAPSHOT_RESOURCES = true;
      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM1
      });
      await percy.idle();
      expect(captured[0].length).toBeLessThanOrEqual(750);
      expect(logger.stderr).toContain(jasmine.stringMatching(/resource limit reached/));
    });
  });

  describe('discovery retry', () => {
    let Page;
    let fastCount;

    beforeEach(async () => {
      // reset page timeout so that it gets read from env again
      ({ Page } = await import('../src/page.js'));
      Page.TIMEOUT = undefined;
      process.env.PERCY_PAGE_LOAD_TIMEOUT = 500;

      // some async request that takes a while and only resolves 4th time
      let counter = 0;
      server.reply('/', () => new Promise(r => (
        (counter += 1) &&
        setTimeout(r, counter === fastCount ? 0 : 2000, [200, 'text/html', '<html></html>']))));
    });

    afterAll(() => {
      delete process.env.PERCY_PAGE_LOAD_TIMEOUT;
    });

    it('should retry by default on the snapshot discovery upto 3 times', async () => {
      // 3rd request will resolve instantly
      fastCount = 3;

      await percy.snapshot({
        name: 'test navigation timeout',
        url: 'http://localhost:8000',
        widths: [400, 800]
      });

      await percy.idle();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy has started!',
        '[percy] Retrying snapshot: test navigation timeout',
        '[percy] Retrying snapshot: test navigation timeout',
        '[percy] Snapshot taken: test navigation timeout'
      ]));
    });

    it('throws exception after last retry', async () => {
      // 3rd request will also resolve in delayed fashion
      fastCount = 4;

      await percy.snapshot({
        name: 'test navigation timeout',
        url: 'http://localhost:8000',
        discovery: { retry: true },
        widths: [400, 800]
      });

      await percy.idle();

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy has started!',
        '[percy] Retrying snapshot: test navigation timeout',
        '[percy] Retrying snapshot: test navigation timeout'
      ]));

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Encountered an error taking snapshot: test navigation timeout',
        '[percy] Error: Navigation failed: Timed out waiting for the page load event'
      ]));

      sharedExpectBlock({
        data: {
          logs: [
            {
              message: 'Encountered an error taking snapshot: test navigation timeout',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'test navigation timeout' } }
            },
            {
              message: 'Navigation failed: Timed out waiting for the page load event',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'test navigation timeout' } }
            }
          ]
        }
      });
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

      let lastReq = api.requests['/suggestions/from_logs'].length - 1;
      expect(api.requests['/suggestions/from_logs'][lastReq].body).toEqual({
        data: {
          logs: [
            {
              message: 'Encountered an error taking snapshot: navigation idle',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'navigation idle' } }
            },
            {
              message: 'Navigation failed: Timed out waiting for the page load event\n\n  Active requests:\n  - http://localhost:8000/img.gif\n',
              meta: { build: { id: '123', url: 'https://percy.io/test/test/123', number: 1 }, snapshot: { name: 'navigation idle' } }
            }
          ]
        }
      });
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

    it('should merge cookie passed by user', async () => {
      // test cookie array
      await startWithCookies([{
        name: 'test-cookie',
        value: '654321'
      }, {
        name: 'shortbread',
        value: '987654'
      }]);

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: testDOM,
          cookies: 'test-cookie=value; cookie-name=cookie-value'
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual('test-cookie=654321; shortbread=987654; cookie-name=cookie-value');
    });

    it('can send default collected cookies from serialization', async () => {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: testDOM,
          cookies: '__Secure-test-cookie=value'
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual('__Secure-test-cookie=value');
    });

    it('can send default collected cookies from sdk', async () => {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: testDOM,
          cookies: [{ name: 'cookie-via-sdk', value: 'cookie-value' }]
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual('cookie-via-sdk=cookie-value');
    });

    it('does not use cookies if wrong object is passed from sdk', async () => {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: testDOM,
          cookies: [{ wrong_object_key: 'cookie-via-sdk', wrong_object_value: 'cookie-value' }]
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual(undefined);
    });

    it('does not use cookie if empty cookies is passed (in case of httponly)', async () => {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: testDOM,
          cookies: ''
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual(undefined);
    });

    it('should not use captured cookie when PERCY_DO_NOT_USE_CAPTURED_COOKIES is set', async () => {
      process.env.PERCY_DO_NOT_USE_CAPTURED_COOKIES = true;
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      await percy.snapshot({
        name: 'mmm cookies',
        url: 'http://localhost:8000',
        domSnapshot: {
          html: testDOM,
          cookies: 'test-cookie=value'
        }
      });

      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Snapshot taken: mmm cookies'
      ]));

      expect(cookie).toEqual(undefined);
      delete process.env.PERCY_DO_NOT_USE_CAPTURED_COOKIES;
    });
  });

  describe('Dom serialisation', () => {
    it('should contain valid dom serialization values', async () => {
      const page = await percy.browser.page();
      await page.goto('http://localhost:8000');
      await page.insertPercyDom();
      let capture = await page.eval((_) => ({
        /* eslint-disable-next-line no-undef */
        domSnapshot: PercyDOM.serialize(),
        url: document.URL
      }));

      PercyConfig.addSchema(CoreConfig.schemas);
      const errors = PercyConfig.validate(capture, '/snapshot/dom');
      expect(errors).toBe(undefined);
    });

    it('should not fail dom collection if cookie can not be collected', async () => {
      const page = await percy.browser.page();
      await page.goto('about:blank');
      await page.insertPercyDom();
      let capture = await page.eval((_) => ({
        /* eslint-disable-next-line no-undef */
        domSnapshot: PercyDOM.serialize(),
        url: document.URL
      }));

      expect(capture.domSnapshot.html).toBeDefined();
      expect(capture.domSnapshot.warnings).toEqual(["Could not capture cookies: Failed to read the 'cookie' property from 'Document': Access is denied for this document."]);
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
        domSnapshot: testExternalDOM,
        discovery: {
          disallowedHostnames: ['ex.localhost']
        }
      });

      await percy.idle();

      let paths = server.requests.map(r => r[0]);
      expect(paths).toContain('/style.css');
      expect(paths).not.toContain('/img.gif');
      // With disallowedHostnames, the request is blocked and never made to the external server
      let paths2 = server2.requests.map(r => r[0]);
      expect(paths2).not.toContain('/img.gif');

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
        enableJavaScript: true,
        discovery: {
          disallowedHostnames: ['ex.localhost']
        }
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
          disallowedHostnames: ['localhost', 'ex.localhost']
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
        url: 'http://test.localhost:8001',
        discovery: {
          disallowedHostnames: ['embed.localhost']
        }
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

  describe('with auto domain validation', () => {
    let testExternalDOM = testDOM.replace('img.gif', 'http://ex.localhost:8001/img.gif');
    let server2;
    let validationMock;

    beforeEach(async () => {
      // Create an external server for resources
      server2 = await createTestServer({
        '/img.gif': () => [200, 'image/gif', pixel]
      }, 8001);

      // Mock the Cloudflare worker validation endpoint
      validationMock = await mockRequests('https://winter-morning-fa32.shobhit-k.workers.dev', () => [
        200, { accessible: false, reason: 'unknown domain' }
      ]);
    });

    afterEach(async () => {
      await server2.close();
    });

    it('blocks external domains when validation service returns not allowed', async () => {
      await percy.stop();

      // Configure validation mock to return accessible: true (domain validates but isn't added to allowed list)
      validationMock.and.returnValue([200, { accessible: true, reason: 'not a recognized CDN' }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL so validation happens
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify the validation mock was called
      expect(validationMock).toHaveBeenCalled();

      // Verify external resource was NOT captured (accessible: true doesn't add to allowed list)
      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );
    });

    it('allows external domains when validation service returns allowed', async () => {
      await percy.stop();

      // Configure validation mock to return no accessible field (undefined) so !result?.accessible is truthy (ALLOWED)
      validationMock.and.returnValue([200, { reason: 'known CDN: Cloudflare' }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL so validation happens
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify the validation mock was called
      expect(validationMock).toHaveBeenCalled();

      // Verify external resource WAS captured (allowed by validation)
      expect(captured[0]).toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );

      // Log should show domain validation allowing
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Domain validation:.*ex\.localhost.*validated as ALLOWED/)
      ]));
    });

    it('uses pre-approved domains from session cache without calling validation service', async () => {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Pre-populate session cache with approved domain
      percy.domainValidation.autoConfiguredHosts.add('ex.localhost');

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify the validation mock was NOT called (domain was pre-approved)
      expect(validationMock).not.toHaveBeenCalled();

      // Verify external resource WAS captured (pre-approved)
      expect(captured[0]).toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );

      // Log should show domain was captured using auto-validated domain
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Capturing auto-validated domain: ex\.localhost/)
      ]));
    });

    it('validates and blocks domains that are not in pre-approved list', async () => {
      await percy.stop();

      // Configure validation mock to return accessible: true (not added to allowed list)
      validationMock.and.returnValue([200, { accessible: true, reason: 'not allowed' }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL so validation happens
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify the validation mock was called
      expect(validationMock).toHaveBeenCalled();

      // Verify external resource was NOT captured (not in allowed list)
      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );
    });

    it('caches validation results for subsequent requests', async () => {
      await percy.stop();

      // Configure validation mock to return accessible: false (treated as allowed)
      validationMock.and.returnValue([200, { accessible: false, reason: 'known CDN' }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL so validation happens
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      // Take first snapshot
      await percy.snapshot({
        name: 'test snapshot 1',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      const firstCallCount = validationMock.calls.count();

      // Take second snapshot with same external domain
      await percy.snapshot({
        name: 'test snapshot 2',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      const secondCallCount = validationMock.calls.count();

      // Validation mock should only be called once (result cached from first snapshot)
      expect(firstCallCount).toBe(1);
      expect(secondCallCount).toBe(1);
    });

    it('allows domain on validation service failure (fail-open)', async () => {
      await percy.stop();

      // Configure validation mock to return error
      validationMock.and.returnValue([500, 'Internal Server Error']);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL so validation happens
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify external resource was NOT captured (error sets processedDomains to null)
      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );

      // Log should show warning about validation failure - warn logs go to stderr
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Domain validation: Failed to validate.*/)
      ]));
    });

    it('respects manual allowedHostnames over auto validation', async () => {
      await percy.stop();

      // Configure validation mock to return blocked (should be ignored)
      validationMock.and.returnValue([200, { accessible: false, reason: 'not allowed' }]);

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

      // Validation mock should NOT be called (manual allowedHostnames takes precedence)
      expect(validationMock).not.toHaveBeenCalled();

      // Verify external resource WAS captured (manually allowed)
      expect(captured[0]).toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );
    });

    it('respects manual disallowedHostnames over auto validation', async () => {
      await percy.stop();

      // Configure validation mock to return allowed (should be ignored)
      validationMock.and.returnValue([200, { accessible: true, reason: 'known CDN' }]);

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

      // Validation mock should NOT be called (manual disallowedHostnames takes precedence)
      expect(validationMock).not.toHaveBeenCalled();

      // Verify external resource was NOT captured (manually disallowed)
      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );
    });

    it('loads domain config early from API before discovery starts', async () => {
      await percy.stop();

      // Clear previous mocks and set up new one
      api.replies['/projects/domain-config'] = [];

      // Mock API response for domain config endpoint
      api.reply('/projects/domain-config', () => [200, {
        data: {
          type: 'projects',
          attributes: {
            'domain-config': {
              'allowed-domains': ['cdn.example.com', 'images.example.com'],
              'updated-at': '2024-01-01T00:00:00Z',
              'last-build-id': '123'
            },
            'domain-validator-worker-url': 'https://winter-morning-fa32.shobhit-k.workers.dev'
          }
        }
      }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Verify domain config was loaded early
      expect(percy.domainValidation.autoConfiguredHosts.size).toBe(2);
      expect(percy.domainValidation.autoConfiguredHosts.has('cdn.example.com')).toBe(true);
      expect(percy.domainValidation.autoConfiguredHosts.has('images.example.com')).toBe(true);
      expect(percy.domainValidation.workerUrl).toBe('https://winter-morning-fa32.shobhit-k.workers.dev');
    });

    it('handles missing domain config gracefully during early load', async () => {
      await percy.stop();

      // Clear previous mocks and set up empty config
      api.replies['/projects/domain-config'] = [];

      // Mock API response with no domain config
      api.reply('/projects/domain-config', () => [200, {
        data: {
          type: 'projects',
          attributes: {}
        }
      }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Verify domain validation structure is empty but initialized
      expect(percy.domainValidation.autoConfiguredHosts.size).toBe(0);
      expect(percy.domainValidation.newAllowedHosts.size).toBe(0);
      expect(percy.domainValidation.newErrorHosts.size).toBe(0);
    });

    it('continues without domain config if API call fails during early load', async () => {
      await percy.stop();

      // Clear previous mocks and set up error response
      api.replies['/projects/domain-config'] = [];

      // Mock API to return error
      api.reply('/projects/domain-config', () => [404, 'Not Found']);

      logger.loglevel('debug');

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Verify domain validation structure is empty but Percy still starts
      expect(percy.domainValidation.autoConfiguredHosts.size).toBe(0);
      expect(percy.domainValidation.newAllowedHosts.size).toBe(0);
      expect(percy.domainValidation.newErrorHosts.size).toBe(0);

      // Log should show debug message about early load failure from the client
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Failed to fetch project domain config/)
      ]));
    });

    it('skips domain validation when autoConfigureAllowedHostnames is disabled', async () => {
      await percy.stop();

      // Configure validation mock to return allowed
      validationMock.and.returnValue([200, {}]);

      // Clear previous mocks
      api.replies['/projects/domain-config'] = [];

      // Mock API response for domain config endpoint
      api.reply('/projects/domain-config', () => [200, {
        data: {
          type: 'projects',
          attributes: {
            'domain-config': {
              'allowed-domains': []
            },
            'domain-validator-worker-url': 'https://winter-morning-fa32.shobhit-k.workers.dev'
          }
        }
      }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        discovery: {
          autoConfigureAllowedHostnames: false
        }
      });

      // Verify the setting was applied
      expect(percy.config.discovery.autoConfigureAllowedHostnames).toBe(false);

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify the validation mock was NOT called
      expect(validationMock).not.toHaveBeenCalled();

      // Verify external resource was NOT captured (domain validation disabled)
      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );

      // Verify no new domains were added
      expect(percy.domainValidation.newAllowedHosts.size).toBe(0);
      expect(percy.domainValidation.newErrorHosts.size).toBe(0);
    });

    it('validates domain with error response and marks as blocked', async () => {
      await percy.stop();

      // Configure validation mock to return error field
      validationMock.and.returnValue([200, { error: true, reason: 'domain is blocked' }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL so validation happens
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      // Verify the validation mock was called
      expect(validationMock).toHaveBeenCalled();

      // Verify external resource was NOT captured (error response blocks domain)
      expect(captured[0]).not.toContain(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://ex.localhost:8001/img.gif'
          })
        })
      );

      // Verify domain was added to error hosts
      expect(percy.domainValidation.newErrorHosts.has('ex.localhost')).toBe(true);

      // Log should show domain was validated as BLOCKED
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Domain validation:.*ex\.localhost.*validated as BLOCKED/)
      ]));
    });

    it('handles invalid URLs gracefully during hostname extraction', async () => {
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      // Create DOM with completely malformed URL that will throw when parsed
      const malformedDOM = testDOM.replace('img.gif', ':::invalid-url:::');

      logger.loglevel('debug');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: malformedDOM,
        widths: [1000]
      });

      await percy.idle();

      // Should complete without crashing - the invalid URL parsing is caught
      expect(captured.length).toBeGreaterThan(0);

      // Should log the resource processing
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        jasmine.stringMatching(/Processing resource:.*:::invalid-url:::/)
      ]));
    });

    it('returns cached validation result for previously validated domains', async () => {
      await percy.stop();

      // Configure validation mock to return allowed
      validationMock.and.returnValue([200, { accessible: false }]);

      percy = await Percy.start({
        token: 'PERCY_TOKEN'
      });

      // Set the worker URL
      percy.domainValidation.workerUrl = 'https://winter-morning-fa32.shobhit-k.workers.dev';

      logger.loglevel('debug');

      // First snapshot to trigger validation
      await percy.snapshot({
        name: 'test snapshot 1',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      const callCountAfterFirst = validationMock.calls.count();
      expect(callCountAfterFirst).toBe(1);

      // Verify domain is in processedDomains cache
      expect(percy.domainValidation.processedDomains.has('ex.localhost')).toBe(true);

      // Second snapshot with same domain should use cached result
      await percy.snapshot({
        name: 'test snapshot 2',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      const callCountAfterSecond = validationMock.calls.count();
      // Should still be 1 - no new validation call (cached result used)
      expect(callCountAfterSecond).toBe(1);
    });
  });

  describe('with launch options', () => {
    beforeEach(async () => {
      // ensure a new percy instance is used for each test
      await percy?.stop(true);
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

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Browser executable not found: ./404'
      ]));
    });

    it('can provide an executable via an environment variable', async () => {
      process.env.PERCY_BROWSER_EXECUTABLE = './from-var';

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] }
      });

      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Browser executable not found: ./from-var'
      ]));
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

      // We are checking here like this, to avoid flaky test as
      // the error message contains some number
      // eg: `Failed to launch browser. \n[0619/152313.736334:ERROR:command_line_handler.cc(67)`
      let lastRequest = api.requests['/suggestions/from_logs'].length - 1;
      expect(api.requests['/suggestions/from_logs'][lastRequest].body.data.logs[0].message.includes('Failed to launch browser'))
        .toEqual(true);
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

      let expectedBody = {
        data: {
          logs: [
            { message: "Failed to launch browser. Timed out after 10ms\n'\n\n" }
          ]
        }
      };

      sharedExpectBlock(expectedBody);
    });

    it('does not close the browser when closeBrowser is false', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          launchOptions: {
            closeBrowser: false
          }
        }
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      // Check if browser is still connected after snapshot and idle
      expect(percy.browser.isConnected()).toBe(true);
      // Explicitly stop percy to close the browser for subsequent tests
      await percy.browser.close(true); // force close
      expect(percy.browser.isConnected()).toBe(false);
    });

    it('closes the browser by default when closeBrowser is not set', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          launchOptions: {} // closeBrowser is not set
        }
      });
      const browserInstance = percy.browser;
      spyOn(browserInstance, 'close').and.callThrough();

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      // Percy stop is called internally, which should close the browser
      await percy.stop(true);
      expect(browserInstance.close).toHaveBeenCalled();
      expect(browserInstance.isConnected()).toBe(false);
    });

    it('closes the browser when closeBrowser is true', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          launchOptions: {
            closeBrowser: true
          }
        }
      });
      const browserInstance = percy.browser;
      spyOn(browserInstance, 'close').and.callThrough();

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();
      // Percy stop is called internally, which should close the browser
      await percy.stop(true);
      expect(browserInstance.close).toHaveBeenCalled();
      expect(browserInstance.isConnected()).toBe(false);
    });
  });

  describe('Browser restart on disconnection', () => {
    let testDOM;

    beforeEach(async () => {
      testDOM = '<html><body><p>Test</p></body></html>';
      // ensure a new percy instance is used for each test
      await percy?.stop(true);
    });

    it('restarts the browser when it is disconnected', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      const browserInstance = percy.browser;
      const originalPid = browserInstance.process.pid;

      // Close the browser to simulate disconnection
      await browserInstance.close(true);
      expect(browserInstance.isConnected()).toBe(false);

      // Restart should launch a new browser
      await browserInstance.restart();
      expect(browserInstance.isConnected()).toBe(true);
      expect(browserInstance.process.pid).not.toBe(originalPid);
      expect(browserInstance.readyState).toBe(1); // connected state

      await percy.stop(true);
    });

    it('restarts the browser automatically in page() when disconnected', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 }
      });

      const browserInstance = percy.browser;
      spyOn(browserInstance, 'restart').and.callThrough();

      // Close the browser to simulate disconnection
      await browserInstance.close(true);
      expect(browserInstance.isConnected()).toBe(false);

      // Creating a page should trigger auto-restart
      const page = await browserInstance.page();
      expect(browserInstance.restart).toHaveBeenCalled();
      expect(browserInstance.isConnected()).toBe(true);
      expect(page).toBeDefined();

      await page.close();
      await percy.stop(true);
    });

    it('retries snapshot with browser restart on "Browser not connected" error', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          concurrency: 1,
          retry: true
        }
      });

      const browserInstance = percy.browser;
      spyOn(browserInstance, 'restart').and.callThrough();

      let attemptCount = 0;
      const originalPage = browserInstance.page.bind(browserInstance);
      spyOn(browserInstance, 'page').and.callFake(async function(...args) {
        attemptCount++;
        if (attemptCount === 1) {
          // Simulate browser crash on first attempt
          await browserInstance.close(true);
          throw new Error('Browser not connected');
        }
        // Succeed on retry
        return originalPage(...args);
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM,
        port: 0
      });

      await percy.idle();

      expect(browserInstance.restart).toHaveBeenCalled();
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Retrying snapshot: test snapshot'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Detected browser disconnection, restarting browser before retry'
      ]));
      await percy.stop(true);
    });

    it('retries snapshot with browser restart on "Session closed" error', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          concurrency: 1
        }
      });

      const browserInstance = percy.browser;
      spyOn(browserInstance, 'restart').and.callThrough();

      let attemptCount = 0;
      const originalPage = browserInstance.page.bind(browserInstance);
      spyOn(browserInstance, 'page').and.callFake(async function(...args) {
        attemptCount++;
        if (attemptCount === 1) {
          await browserInstance.close(true);
          throw new Error('Session closed');
        }
        return originalPage(...args);
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();

      expect(browserInstance.restart).toHaveBeenCalled();
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Retrying snapshot: test snapshot'
      ]));
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Detected browser disconnection, restarting browser before retry'
      ]));
      await percy.stop(true);
    });

    it('logs error and throws when browser restart fails', async () => {
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: {
          concurrency: 1
        }
      });

      const browserInstance = percy.browser;
      spyOn(browserInstance, 'restart').and.rejectWith(new Error('Restart failed'));

      let attemptCount = 0;
      spyOn(browserInstance, 'page').and.callFake(async function(...args) {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Browser not connected');
        }
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testDOM
      });

      await percy.idle();

      expect(browserInstance.restart).toHaveBeenCalled();
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy] Detected browser disconnection, restarting browser before retry',
        '[percy] Failed to restart browser: Error: Restart failed',
        '[percy] Encountered an error taking snapshot: test snapshot',
        jasmine.stringMatching(/Error: Restart failed/)
      ]));
      await percy.stop(true);
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

  describe('waitForSelector/waitForTimeout at the time of discovery when Js is enabled =>', () => {
    it('calls waitForTimeout, waitForSelector and page.eval when their respective arguments are given', async () => {
      let capturedPage;
      const originalPageMethod = percy.browser.page.bind(percy.browser);
      spyOn(percy.browser, 'page').and.callFake(async (options) => {
        capturedPage = await originalPageMethod(options);
        spyOn(capturedPage, 'eval').and.callThrough();
        return capturedPage;
      });

      percy.loglevel('debug');

      await percy.snapshot({
        name: 'test discovery',
        url: 'http://localhost:8000',
        enableJavaScript: true,
        discovery: {
          waitForTimeout: 100,
          waitForSelector: 'body'
        }
      });
      await percy.idle();

      expect(capturedPage.eval).toHaveBeenCalledWith('await waitForSelector("body", 30000)');
      expect(logger.stderr).toEqual(jasmine.arrayContaining([
        '[percy:core:discovery] Wait for selector: body',
        '[percy:core:discovery] Wait for 100ms timeout'
      ]));
    });
  });
  describe('waitForSelector/waitForTimeout at the time of discovery when Js is disabled =>', () => {
    it('donot calls waitForTimeout, waitForSelector and page.eval', async () => {
      const page2 = await percy.browser.page();
      spyOn(page2, 'eval').and.callThrough();
      percy.loglevel('debug');

      await percy.snapshot({
        name: 'test discovery 2',
        url: 'http://localhost:8000',
        cliEnableJavaScript: false,
        discovery: {
          waitForTimeout: 100,
          waitForSelector: 'flex'
        }
      });

      await percy.idle();

      expect(page2.eval).not.toHaveBeenCalledWith('await waitForSelector("flex", 30000)');
      expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
        '[percy:core:discovery] Wait for 100ms timeout',
        '[percy:core:discovery] Wait for selector: flex'
      ]));
    });
    it('when domSnapshot is present with default parameters waitForSelector/waitForTimeout are not called', async () => {
      percy.loglevel('debug');

      await percy.snapshot({
        name: 'test discovery 3',
        url: 'http://localhost:8000',
        domSnapshot: testDOM,
        discovery: {
          waitForTimeout: 100,
          waitForSelector: 'body'
        }
      });

      await percy.idle();

      expect(logger.stderr).not.toEqual(jasmine.arrayContaining([
        '[percy:core:discovery] Wait for 100ms timeout',
        '[percy:core:discovery] Wait for selector: body'
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
    afterEach(() => {
      delete process.env.PERCY_DO_NOT_CAPTURE_RESPONSIVE_ASSETS;
    });
    it('should capture js based assets', async () => {
      api.reply('/discovery/device-details?build_id=123', () => [200, { data: [{ width: 375, deviceScaleFactor: 2 }, { width: 390, deviceScaleFactor: 3 }] }]);
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

    it('should not capture js based assets and returns default', async () => {
      process.env.PERCY_DO_NOT_CAPTURE_RESPONSIVE_ASSETS = 'true';
      api.reply('/discovery/device-details?build_id=123', () => [200, { data: [{ width: 375, deviceScaleFactor: 2 }, { width: 390, deviceScaleFactor: 3 }] }]);
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
        resource('/default.jpg')
      ]));

      expect(captured[0]).not.toContain(jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/large.jpg'
        })
      }));
    });

    it('handle cases when asset was changed on load', async () => {
      api.reply('/discovery/device-details?build_id=123', () => [200, { data: [{ width: 390, deviceScaleFactor: 3 }] }]);
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
              if (dpr == 2) {
                image.src = '/small.jpg';
              } else if (dpr == 3) {
                image.src = '/medium.jpg';
              }
            }
            window.addEventListener('load', updateImage);
        </script>
        </body>
        </html>
      `;

      server.reply('/', () => [200, 'text/html', responsiveDOM]);
      server.reply('/default.jpg', () => [200, 'image/jpg', pixel]);
      server.reply('/small.jpg', () => [200, 'image/jpg', pixel]);
      server.reply('/medium.jpg', () => [200, 'image/jpg', pixel]);

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
        resource('/medium.jpg')
      ]));

      expect(captured[0]).not.toContain(jasmine.objectContaining({
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/small.jpg'
        })
      }));
    });

    it('captures responsive assets srcset + mediaquery', async () => {
      api.reply('/discovery/device-details?build_id=123', () => [200,
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

  describe('Handles multiple root resources', () => {
    it('gathers multiple resources for a snapshot', async () => {
      let DOM1 = testDOM.replace('Percy!', 'Percy! at 370');
      let DOM2 = testDOM.replace('Percy!', 'Percy! at 765');
      const capturedResource = {
        url: 'http://localhost:8000/img-already-captured.png',
        content: 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
        mimetype: 'image/png'
      };

      const capturedResource1 = {
        url: 'http://localhost:8000/img-captured.png',
        content: 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
        mimetype: 'image/png'
      };

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        responsiveSnapshotCapture: true,
        widths: [365, 1280],
        domSnapshot: [{
          html: testDOM,
          width: 1280,
          cookies: [{ name: 'value' }]
        }, {
          html: DOM1,
          resources: [capturedResource],
          width: 370
        }, {
          html: DOM2,
          resources: [capturedResource1],
          width: 765
        }]
      });

      await percy.idle();

      let paths = server.requests.map(r => r[0]);
      // does not request the root url (serves domSnapshot instead)
      expect(paths).not.toContain('/');
      expect(paths).toContain('/style.css');
      expect(paths).toContain('/img.gif');

      expect(captured[0]).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          id: sha256hash(testDOM),
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/',
            'is-root': true,
            'for-widths': [1280]
          })
        }),
        jasmine.objectContaining({
          id: sha256hash(DOM1),
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/',
            'is-root': true,
            'for-widths': [370]
          })
        }),
        jasmine.objectContaining({
          id: sha256hash(DOM2),
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/',
            'is-root': true,
            'for-widths': [765]
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/img-already-captured.png'
          })
        }),
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/img-captured.png'
          })
        })
      ]));
    });

    it('injects the percy-css resource into all dom snapshots', async () => {
      const simpleDOM = dedent`
        <html>
        <head></head>
        <body>
          <p>Hello Percy!<p>
        </body>
        </html>
      `;
      let DOM1 = simpleDOM.replace('Percy!', 'Percy! at 370');

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        responsiveSnapshotCapture: true,
        percyCSS: 'body { color: purple; }',
        domSnapshot: [{
          html: simpleDOM,
          width: 1280
        }, {
          html: DOM1,
          width: 370
        }]
      });

      await percy.idle();

      let cssURL = new URL((api.requests['/builds/123/snapshots'][0].body.data.relationships.resources.data).find(r => r.attributes['resource-url'].endsWith('.css')).attributes['resource-url']);
      let injectedDOM = simpleDOM.replace('</body>', (
       `<link data-percy-specific-css rel="stylesheet" href="${cssURL.pathname}"/>`
      ) + '</body>');
      let injectedDOM1 = DOM1.replace('</body>', (
        `<link data-percy-specific-css rel="stylesheet" href="${cssURL.pathname}"/>`
      ) + '</body>');

      expect(captured[0]).toEqual(jasmine.arrayContaining([
        jasmine.objectContaining({
          id: sha256hash(injectedDOM),
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/',
            'is-root': true,
            'for-widths': [1280]
          })
        }),
        jasmine.objectContaining({
          id: sha256hash(injectedDOM1),
          attributes: jasmine.objectContaining({
            'resource-url': 'http://localhost:8000/',
            'is-root': true,
            'for-widths': [370]
          })
        })
      ]));
    });
  });
  describe('Scroll to bottom functionality', () => {
    let percy, server, captured;

    // Create test DOM with tall content that would require scrolling
    const testDOM = dedent`
      <html>
      <head><link href="style.css" rel="stylesheet"/></head>
      <body>
        <div id="top-content">Top content</div>
        <div style="height: 2000px;">Tall content</div>
        <img id="lazy-image" loading="lazy" src="lazy-image.gif" />
        <div id="bottom-content">Bottom content</div>
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

      // Set up API response for snapshots
      api.reply('/builds/123/snapshots', ({ body }) => {
        captured.push(body.data.relationships.resources.data.sort((a, b) => (
          a.attributes['resource-url'].localeCompare(b.attributes['resource-url'])
        )));

        return [201, { data: { id: '4567' } }];
      });

      // Create a new server for each test with test routes - use port 8080 explicitly
      server = await createTestServer({
        '/': () => [200, 'text/html', testDOM],
        '/style.css': () => [200, 'text/css', testCSS],
        '/lazy-image.gif': () => [200, 'image/gif', pixel]
      }, 8080);

      // Stop any running Percy instance
      try {
        await Percy.stop();
      } catch (e) {
        // Ignore if Percy wasn't running
      }

      // Create a fresh Percy instance for each test
      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        snapshot: { widths: [1000] },
        discovery: { concurrency: 1 },
        port: 0
      });
    });

    afterEach(async () => {
      // Clean up after each test
      await percy?.stop(true);
      await server?.close();
    });

    it('captures lazy-loaded images when scrollToBottom option is enabled', async () => {
      // Take a snapshot with scrollToBottom enabled
      await percy.snapshot({
        name: 'scroll to bottom test',
        url: 'http://localhost:8080',
        enableJavaScript: true,
        discovery: {
          scrollToBottom: true
        }
      });

      await percy.idle();

      // Check if the lazy image was loaded (indicating scrolling worked)
      const lazyImageResource = captured[0].find(resource =>
        resource.attributes['resource-url'] === 'http://localhost:8080/lazy-image.gif'
      );

      expect(lazyImageResource).toBeDefined();
    });

    it('does not capture lazy-loaded images when scrollToBottom option is disabled', async () => {
      // Create a modified DOM where the image is truly lazy-loaded (will only load on scroll)
      const lazyDOM = testDOM.replace('loading="lazy"', 'loading="lazy" data-src="lazy-image.gif" src=""');

      server.reply('/', () => [200, 'text/html', lazyDOM]);

      // Take a Percy snapshot with scrollToBottom disabled
      await percy.snapshot({
        name: 'no scroll to bottom test',
        url: 'http://localhost:8080',
        enableJavaScript: true
      });

      await percy.idle();

      // Check that the lazy image was NOT loaded (indicating no scrolling happened)
      const lazyImageResource = captured[0].find(resource =>
        resource.attributes['resource-url'] === 'http://localhost:8080/lazy-image.gif'
      );

      expect(lazyImageResource).toBeUndefined();
    });

    it('does not scroll to bottom when JavaScript is disabled', async () => {
      const page = await percy.browser.page();
      const evalSpy = spyOn(page.constructor.prototype, 'evaluate').and.callThrough();
      await page.close();

      // Take a snapshot with JavaScript disabled but scrollToBottom enabled
      await percy.snapshot({
        name: 'js disabled scroll test',
        url: 'http://localhost:8080',
        cliEnableJavaScript: false,
        discovery: {
          scrollToBottom: true
        }
      });

      await percy.idle();

      const scrollCalls = evalSpy.calls.all()
        .filter(call => call.args[0] && call.args[0].toString().includes('scrollTo'));

      expect(scrollCalls.length).toBe(0);
    });

    it('scrolls to bottom for each width when multiple widths are specified', async () => {
      server.reply('/lazy-image-small.gif', () => [200, 'image/gif', pixel]);
      server.reply('/lazy-image-large.gif', () => [200, 'image/gif', pixel]);

      const responsiveDOM = dedent`
        <html>
        <head><link href="style.css" rel="stylesheet"/></head>
        <body>
          <div id="top-content">Top content</div>
          <div style="height: 2000px;">Tall content</div>
          <!-- Use a more reliable method to create the responsive images -->
          <script>
            // Create and add the appropriate image based on viewport width
            function createAndAppendImage() {
              // Remove any existing lazy-loaded images first
              const existingImg = document.getElementById("lazy-image");
              if (existingImg) existingImg.remove();
              
              const img = document.createElement('img');
              img.id = "lazy-image";
              img.loading = "lazy";
              
              // Set the source based on the viewport width
              if (window.innerWidth <= 500) {
                img.src = "lazy-image-small.gif";
                img.setAttribute('data-size', 'small');
              } else {
                img.src = "lazy-image-large.gif";
                img.setAttribute('data-size', 'large');
              }
              
              // Add the image at the bottom of the page
              document.getElementById("bottom-content").appendChild(img);
            }
            
            // Run on initial load
            window.addEventListener('load', createAndAppendImage);
            
            // Also run when the page is resized
            window.addEventListener('resize', createAndAppendImage);
          </script>
          <div id="bottom-content"></div>
        </body>
        </html>
      `;

      server.reply('/', () => [200, 'text/html', responsiveDOM]);

      await percy.snapshot({
        name: 'multiple widths scroll test',
        url: 'http://localhost:8080',
        enableJavaScript: true,
        widths: [400, 800],
        discovery: {
          scrollToBottom: true,
          networkIdleTimeout: 500
        }
      });

      await percy.idle();

      const smallImageResource = captured[0].find(resource =>
        resource.attributes['resource-url'] === 'http://localhost:8080/lazy-image-small.gif'
      );

      const largeImageResource = captured[0].find(resource =>
        resource.attributes['resource-url'] === 'http://localhost:8080/lazy-image-large.gif'
      );

      expect(smallImageResource).toBeDefined('Small image resource should be captured');
      expect(largeImageResource).toBeDefined('Large image resource should be captured');
    });
  });
});
