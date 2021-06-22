import { sha256hash } from '@percy/client/dist/utils';
import { mockAPI, createTestServer, dedent, logger } from './helpers';
import Percy from '../src';

describe('Discovery', () => {
  let percy, server, captured;

  let testDOM = dedent`
    <html>
    <head><link href="style.css" rel="stylesheet"/></head>
    <body>
      <p>Hello Percy!<p><img src="img.gif" decoding="async"/>
      ${' '.repeat(1000)}
    </body>
    </html>
  `;

  let testCSS = dedent`
    p { color: purple; }
  `;

  // http://png-pixel.com/
  let pixel = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

  beforeEach(async () => {
    captured = [];

    mockAPI.reply('/builds/123/snapshots', ({ body }) => {
      captured.push(
        // order is not important, stabilize it for testing
        body.data.relationships.resources.data
          .sort((a, b) => (
            a.attributes['resource-url'] < b.attributes['resource-url'] ? -1
              : (a.attributes['resource-url'] > b.attributes['resource-url'] ? 1 : 0)
          ))
      );

      return [201, { data: { id: '4567' } }];
    });

    server = await createTestServer({
      '/': () => [200, 'text/html', testDOM],
      '/style.css': () => [200, 'text/css', testCSS],
      '/img.gif': () => [200, 'image/gif', pixel]
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

  it('follows redirects', async () => {
    server.reply('/stylesheet.css', () => [301, { Location: '/style.css' }]);

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM.replace('style.css', 'stylesheet.css')
    });

    await percy.idle();
    let paths = server.requests.map(r => r[0]);
    expect(paths).toContain('/stylesheet.css');
    expect(paths).toContain('/style.css');

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        id: sha256hash(testCSS),
        attributes: jasmine.objectContaining({
          'resource-url': 'http://localhost:8000/stylesheet.css'
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
      '[percy:core:discovery] -> Skipping empty response'
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

  it('does not capture event-stream reqeusts', async () => {
    let eventStreamDOM = dedent`<!DOCTYPE html><html><head></head><body><script>
      new EventSource('/event-stream').onmessage = event => {
        let p = document.createElement('p');
        p.textContent = event.data;
        document.body.appendChild(p);
      };
    </script></body></html>`;

    server.reply('/events', () => [200, 'text/html', eventStreamDOM]);
    server.reply('/event-stream', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // network idle should wait for the first event, so delay it to make sure
      setTimeout(() => res.write('data: This came from a server-sent event\n\n'), 1000);
    });

    await percy.snapshot({
      name: 'test event snapshot',
      url: 'http://localhost:8000/events',
      enableJavaScript: true
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
      '[percy:core:discovery] -> Skipping disallowed status [202]'
    );
  });

  it('does not capture large files', async () => {
    server.reply('/large.css', () => [200, 'text/css', 'A'.repeat(16_000_000)]);
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
      '[percy:core:discovery] -> Skipping resource larger than 15MB'
    );
  });

  it('logs detailed debug logs', async () => {
    percy.loglevel('debug');

    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM,
      clientInfo: 'test client info',
      environmentInfo: 'test env info',
      widths: [400, 1200],
      discovery: {
        allowedHostnames: ['example.com'],
        requestHeaders: { 'X-Foo': 'Bar' },
        disableCache: true
      }
    });

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy:core] Snapshot taken: test snapshot'
    ]));

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy:core] ---------',
      '[percy:core] Handling snapshot:',
      '[percy:core] -> name: test snapshot',
      '[percy:core] -> url: http://localhost:8000',
      '[percy:core] -> widths: 400px, 1200px',
      '[percy:core] -> minHeight: 1024px',
      '[percy:core] -> discovery.allowedHostnames: example.com',
      '[percy:core] -> discovery.requestHeaders: {"X-Foo":"Bar"}',
      '[percy:core] -> discovery.disableCache: true',
      '[percy:core] -> clientInfo: test client info',
      '[percy:core] -> environmentInfo: test env info',
      '[percy:core:page] Initialize page',
      '[percy:core:page] Navigate to: http://localhost:8000',
      '[percy:core:discovery] Handling request: http://localhost:8000/',
      '[percy:core:discovery] -> Serving root resource',
      '[percy:core:discovery] Handling request: http://localhost:8000/style.css',
      '[percy:core:discovery] Handling request: http://localhost:8000/img.gif',
      '[percy:core:discovery] Processing resource: http://localhost:8000/style.css',
      `[percy:core:discovery] -> sha: ${sha256hash(testCSS)}`,
      '[percy:core:discovery] -> mimetype: text/css',
      '[percy:core:discovery] Processing resource: http://localhost:8000/img.gif',
      `[percy:core:discovery] -> sha: ${sha256hash(pixel)}`,
      '[percy:core:discovery] -> mimetype: image/gif',
      '[percy:core:page] Page navigated',
      '[percy:core:network] Wait for 100ms idle',
      '[percy:core:page] Page closing'
    ]));
  });

  it('logs failed request errors with a debug loglevel', async () => {
    percy.loglevel('debug');
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost:8000',
      domSnapshot: testDOM.replace('style.css', '/404/style.css')
    });

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy:core] Snapshot taken: test snapshot'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      jasmine.stringMatching(new RegExp( // eslint-disable-line prefer-regex-literals
        '^\\[percy:core:discovery\\] Request failed for http://localhost:8000/404/style\\.css: net::'
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
        <img srcset="/img-400w.gif 400w, /img-800w.gif 800w"
             sizes="(max-width: 600px) 400px, 800px"
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
    server.reply('/img-800w.gif', () => [200, 'image/gif', pixel]);
    server.reply('/img-bg-1.gif', () => [200, 'image/gif', pixel]);
    server.reply('/img-bg-2.gif', () => [200, 'image/gif', pixel]);

    await percy.snapshot({
      name: 'test responsive',
      url: 'http://localhost:8000',
      domSnapshot: responsiveDOM,
      widths: [400, 1200]
    });

    await percy.idle();

    let resource = path => jasmine.objectContaining({
      attributes: jasmine.objectContaining({
        'resource-url': `http://localhost:8000${path}`
      })
    });

    expect(captured[0]).toEqual(jasmine.arrayContaining([
      resource('/img-400w.gif'),
      resource('/img-800w.gif'),
      resource('/img-bg-1.gif'),
      resource('/img-bg-2.gif')
    ]));
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
  });

  describe('with resource errors', () => {
    const Page = require('../src/page').default;

    // sabotage this method to trigger unexpected error handling
    function spyOnPageEvent(event, fn) {
      let spy = spyOn(Page.prototype, 'send')
        .and.callFake(function(...args) {
          if (args[0] === event) return fn();
          return spy.and.originalFn.apply(this, args);
        });
    }

    beforeEach(() => {
      percy.loglevel('debug');
    });

    it('logs unhandled request errors gracefully', async () => {
      let err = new Error('some unhandled request error');
      spyOnPageEvent('Fetch.continueRequest', () => Promise.reject(err));

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
      spyOnPageEvent('Network.getResponseBody', () => Promise.reject(err));

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

  describe('with external assets', () => {
    let testExternalDOM = testDOM.replace('img.gif', 'http://test.localtest.me:8001/img.gif');
    let server2;

    beforeEach(async () => {
      server2 = await createTestServer({
        '/img.gif': () => [200, 'image/gif', pixel]
      }, 8001);
    });

    afterEach(async () => {
      await server2.close();
    });

    it('does not capture external assets', async () => {
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

    it('captures assets from allowed hostnames', async () => {
      // stop current instance to create a new one
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        discovery: {
          allowedHostnames: ['*.localtest.me']
        }
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();

      expect(captured[0][3]).toEqual(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://test.localtest.me:8001/img.gif'
          })
        })
      );
    });

    it('captures assets from wildcard hostnames', async () => {
      // stop current instance to create a new one
      await percy.stop();

      percy = await Percy.start({
        token: 'PERCY_TOKEN',
        discovery: {
          allowedHostnames: ['*']
        }
      });

      await percy.snapshot({
        name: 'test snapshot',
        url: 'http://localhost:8000',
        domSnapshot: testExternalDOM,
        widths: [1000]
      });

      await percy.idle();
      expect(captured[0][3]).toEqual(
        jasmine.objectContaining({
          attributes: jasmine.objectContaining({
            'resource-url': 'http://test.localtest.me:8001/img.gif'
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
});
