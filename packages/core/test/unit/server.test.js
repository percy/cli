import { fs, mockfs } from '../helpers/index.js';
import Server from '../../src/server.js';

describe('Unit / Server', () => {
  let server;

  async function request(path, ...args) {
    let { request } = await import('../helpers/request.js');
    return request(new URL(path, server.address()), ...args);
  }

  beforeEach(async () => {
    server = Server.createServer({ port: 8000 });
    await mockfs();
  });

  afterEach(async () => {
    await server.close();
    // wait 2 ticks before resetting memfs too quickly
    await new Promise(r => setImmediate(setImmediate, r));
  });

  describe('#host', () => {
    it('returns the host', async () => {
      expect(server.host).toEqual('::');
    });

    describe('with PERCY_SERVER_HOST set', () => {
      beforeEach(() => {
        process.env.PERCY_SERVER_HOST = 'localhost';
      });

      afterEach(() => {
        delete process.env.PERCY_SERVER_HOST;
      });

      it('returns correct host', async () => {
        expect(server.host).toEqual('localhost');
      });
    });
  });

  describe('#port', () => {
    it('returns the provided default port when not listening', () => {
      expect(server.port).toEqual(8000);
    });

    it('returns the port in use when listening', async () => {
      await server.listen(9000);
      expect(server.port).toEqual(9000);
    });
  });

  describe('#address()', () => {
    it('returns the localhost address for the server', () => {
      // converts default 0.0.0.0 to localhost
      expect(server.address()).toEqual('http://localhost:8000');
    });

    it('does not include the port without a default when not listening', () => {
      expect(Server.createServer().address()).toEqual('http://localhost');
    });

    describe('with PERCY_SERVER_HOST set', () => {
      afterEach(() => {
        delete process.env.PERCY_SERVER_HOST;
      });

      describe('when PERCY_SERVER_HOST=localhost', () => {
        beforeEach(() => {
          process.env.PERCY_SERVER_HOST = 'localhost';
        });

        it('it uses localhost correctly', () => {
          expect(Server.createServer().address()).toEqual('http://localhost');
        });
      });

      describe('when PERCY_SERVER_HOST=120.22.12.1', () => {
        beforeEach(() => {
          process.env.PERCY_SERVER_HOST = '120.22.12.1';
        });

        it('it uses 120.22.12.1 correctly', () => {
          expect(Server.createServer().address()).toEqual('http://120.22.12.1');
        });
      });
    });
  });

  describe('#listen([port])', () => {
    it('resolves when the server begins listening for requests', async () => {
      expect(server.listening).toEqual(false);
      await server.listen();
      expect(server.listening).toEqual(true);
    });

    it('can listen on the provided port instead of the default port', async () => {
      expect(server.port).toEqual(8000);
      await server.listen(9000);
      expect(server.port).toEqual(9000);
    });

    it('rejects when an error occurs trying to listen', async () => {
      await server.listen();
      await expectAsync(
        Server.createServer().listen(server.port)
      ).toBeRejected();
    });

    describe('with PERCY_SERVER_HOST set', () => {
      beforeEach(() => {
        process.env.PERCY_SERVER_HOST = 'localhost';
      });

      afterEach(() => {
        delete process.env.PERCY_SERVER_HOST;
      });

      it('listens on correct host', async () => {
        expect(server.host).toEqual('localhost');
        await server.listen();
        server.route('get', '/test/:path', (req, res) => res.text(req.params.path));
        await expectAsync(request('/test/foo', 'GET')).toBeResolvedTo('foo');

        // as we have a single network interface locally its not easy to test a negative test
        // where with a separate network interface we are unable to access server
      });
    });
  });

  describe('#close()', () => {
    it('resolves when the server stops listening', async () => {
      await server.listen();
      expect(server.listening).toEqual(true);
      await server.close();
      expect(server.listening).toEqual(false);
    });
  });

  describe('#route([method][, pathname], handler)', () => {
    beforeEach(async () => {
      await server.listen();
    });

    it('routes requests matching a method and pathname', async () => {
      server.route('get', '/test/:path', (req, res) => res.text(req.params.path));

      await expectAsync(request('/test/foo', 'GET')).toBeResolvedTo('foo');
      await expectAsync(request('/test/foo', 'POST')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/test/bar', 'GET')).toBeResolvedTo('bar');
      await expectAsync(request('/test/bar', 'PUT')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/foo/bar', 'GET')).toBeRejectedWithError('404 Not Found');
    });

    it('routes requests matching multiple methods for a pathname', async () => {
      server.route(['get', 'post'], '/test', (req, res) => res.text('foo'));

      await expectAsync(request('/test', 'GET')).toBeResolvedTo('foo');
      await expectAsync(request('/test', 'POST')).toBeResolvedTo('foo');
      await expectAsync(request('/test', 'PUT')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/test', 'DELETE')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/foo', 'GET')).toBeRejectedWithError('404 Not Found');
    });

    it('routes requests matching a method for any pathname', async () => {
      server.route('post', (req, res) => res.text(req.url.pathname.slice(1)));

      await expectAsync(request('/foo', 'POST')).toBeResolvedTo('foo');
      await expectAsync(request('/foo', 'GET')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/bar', 'POST')).toBeResolvedTo('bar');
      await expectAsync(request('/bar', 'PUT')).toBeRejectedWithError('404 Not Found');
    });

    it('routes requests matching multiple methods for any pathname', async () => {
      server.route(['get', 'post'], (req, res) => res.text(req.url.pathname.slice(1)));

      await expectAsync(request('/foo', 'GET')).toBeResolvedTo('foo');
      await expectAsync(request('/foo', 'PUT')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/bar', 'POST')).toBeResolvedTo('bar');
      await expectAsync(request('/bar', 'DELETE')).toBeRejectedWithError('404 Not Found');
    });

    it('routes requests matching any method for a pathname', async () => {
      server.route('/test/:path', (req, res) => res.text(req.params.path));

      await expectAsync(request('/test/foo', 'GET')).toBeResolvedTo('foo');
      await expectAsync(request('/test/bar', 'POST')).toBeResolvedTo('bar');
      await expectAsync(request('/test/baz', 'PUT')).toBeResolvedTo('baz');
      await expectAsync(request('/test/qux', 'DELETE')).toBeResolvedTo('qux');
      await expectAsync(request('/foo/bar', 'GET')).toBeRejectedWithError('404 Not Found');
    });

    it('routes requests matching any method and any pathname', async () => {
      server.route((req, res) => res.json(req.url.pathname.slice(1)));

      await expectAsync(request('/foo', 'GET')).toBeResolvedTo('foo');
      await expectAsync(request('/foo', 'POST')).toBeResolvedTo('foo');
      await expectAsync(request('/bar', 'GET')).toBeResolvedTo('bar');
      await expectAsync(request('/bar', 'PUT')).toBeResolvedTo('bar');
      await expectAsync(request('/foo/bar', 'DELETE')).toBeResolvedTo('foo/bar');
    });

    it('can send text, json, or other content with an optional status code', async () => {
      server.route('/:test', (req, res) => res[req.params.test](...req.body));
      let test = (t, b) => request(`/${t}`, { method: 'POST', body: b }, true);

      // dry up expectations below
      let res = (status, type, body = '') => [body, jasmine.objectContaining({
        headers: jasmine.objectContaining(
          typeof type === 'string' ? { 'content-type': type } : type ?? {}),
        statusCode: status
      })];

      await expectAsync(test('text', ['hello']))
        .toBeResolvedTo(res(200, 'text/plain', 'hello'));
      await expectAsync(test('text', [201, 'hello']))
        .toBeResolvedTo(res(201, 'text/plain', 'hello'));
      await expectAsync(test('json', [{ foo: 'bar' }]))
        .toBeResolvedTo(res(200, 'application/json', { foo: 'bar' }));
      await expectAsync(test('json', [202, { foo: 'bar' }]))
        .toBeResolvedTo(res(202, 'application/json', { foo: 'bar' }));
      await expectAsync(test('send', [200, 'text/html', '</p>hello</p>']))
        .toBeResolvedTo(res(200, 'text/html', '</p>hello</p>'));
      await expectAsync(test('send', [201, { 'X-Foo': 'bar' }]))
        .toBeResolvedTo(res(201, { 'x-foo': 'bar' }));
      await expectAsync(test('send', [204]))
        .toBeResolvedTo(res(204));
    });

    it('parses request body contents', async () => {
      server.route('/q', (req, res) => res.json(Object.fromEntries(req.url.searchParams)));
      server.route('/j', (req, res) => res.json(req.body));

      await expectAsync(request('/q?a=b')).toBeResolvedTo({ a: 'b' });
      await expectAsync(request('/j', {
        method: 'POST',
        body: { foo: ['bar', { baz: true }] }
      })).toBeResolvedTo({
        foo: ['bar', { baz: true }]
      });
    });

    it('handles CORS preflight requests', async () => {
      server.route(['get', 'post'], '/1', (req, res) => res.send(200));
      server.route(['put', 'delete'], '/2', (req, res) => res.text(200));

      let res1 = await request('/1', 'OPTIONS', false);

      expect(res1.statusCode).toBe(204);
      expect(res1.headers).toHaveProperty('access-control-allow-origin', '*');
      expect(res1.headers).toHaveProperty('access-control-allow-headers', '*');
      expect(res1.headers).toHaveProperty('access-control-allow-methods', 'GET, POST');

      let res2 = await request('/2', {
        method: 'OPTIONS',
        headers: { 'Access-Control-Request-Headers': 'Content-Type' }
      }, false);

      expect(res2.statusCode).toBe(204);
      expect(res2.headers).toHaveProperty('access-control-allow-origin', '*');
      expect(res2.headers).toHaveProperty('access-control-allow-headers', 'Content-Type');
      expect(res2.headers).toHaveProperty('access-control-allow-methods', 'PUT, DELETE');
    });

    it('handles server errors', async () => {
      server.route('/e/foo', () => { throw new Error('foo'); });
      server.route('/e/bar', () => { throw new Server.Error(418); });
      await expectAsync(request('/e/foo')).toBeRejectedWithError('500 Internal Server Error\nfoo');
      await expectAsync(request('/e/bar')).toBeRejectedWithError('418 I\'m a Teapot');
    });

    it('handles not found errors', async () => {
      let res = await request('/404').catch(e => e.response);

      expect(res.statusCode).toBe(404);
      expect(res.headers).toHaveProperty('content-type', 'text/plain');
      expect(res.body).toEqual('Not Found');
    });

    it('handles json request errors', async () => {
      let res = await request('/404', {
        method: 'POST',
        body: { testing: 'hello?' }
      }).catch(e => e.response);

      expect(res.statusCode).toBe(404);
      expect(res.headers).toHaveProperty('content-type', 'application/json');
      expect(res.body).toEqual({ error: 'Not Found' });
    });
  });

  describe('#serve([pathname], directory[, options])', () => {
    beforeEach(async () => {
      await server.listen();

      fs.$vol.fromJSON({
        './public/index.html': '<p>test</p>',
        './public/foo.html': '<p>foo</p>',
        './public/foo/bar.html': '<p>foo/bar</p>'
      });
    });

    it('serves directory contents at the specified pathname', async () => {
      server.serve('/test', './public');

      await expectAsync(request('/index.html')).toBeRejectedWithError('404 Not Found');
      await expectAsync(request('/test/index.html')).toBeResolvedTo('<p>test</p>');
      await expectAsync(request('/test/foo.html')).toBeResolvedTo('<p>foo</p>');
      await expectAsync(request('/test/foo/bar.html')).toBeResolvedTo('<p>foo/bar</p>');
    });

    it('serves directory contents at the base-url without a pathname', async () => {
      server.serve('./public');

      await expectAsync(request('/index.html')).toBeResolvedTo('<p>test</p>');
      await expectAsync(request('/foo.html')).toBeResolvedTo('<p>foo</p>');
      await expectAsync(request('/foo/bar.html')).toBeResolvedTo('<p>foo/bar</p>');
      await expectAsync(request('/test/index.html')).toBeRejectedWithError('404 Not Found');
    });

    it('serves directory contents derived from url rewrites', async () => {
      server.serve('./public', {
        rewrites: { '/foo/:path+': '/foo/bar.html' },
        cleanUrls: true
      });

      await expectAsync(request('/')).toBeResolvedTo('<p>test</p>');
      await expectAsync(request('/foo')).toBeResolvedTo('<p>foo</p>');
      await expectAsync(request('/foo/bar')).toBeResolvedTo('<p>foo/bar</p>');
      await expectAsync(request('/foo/bar/baz')).toBeResolvedTo('<p>foo/bar</p>');
      await expectAsync(request('/foo/bar/baz/qux')).toBeResolvedTo('<p>foo/bar</p>');
    });

    it('serves partial content from a byte range', async () => {
      server.serve('./public');

      let get = range => request('/foo/bar.html', {
        headers: { Range: `bytes=${range}` }
      }, true);

      let [fromEnd, res1] = await get('-8');
      expect(res1.statusCode).toBe(206);
      expect(res1.headers).toHaveProperty('content-range', 'bytes 6-13/14');
      expect(res1.headers).toHaveProperty('content-length', '8');

      let [toEnd, res2] = await get('6-');
      expect(res2.statusCode).toBe(206);
      expect(res2.headers).toHaveProperty('content-range', 'bytes 6-13/14');
      expect(res2.headers).toHaveProperty('content-length', '8');
      expect(fromEnd).toEqual(toEnd);

      let [foo, res3] = await get('3-5');
      expect(res3.headers).toHaveProperty('content-range', 'bytes 3-5/14');
      expect(res3.headers).toHaveProperty('content-length', '3');
      expect(foo).toEqual('foo');
    });

    it('serves static error pages if present', async () => {
      server.serve('./public');

      fs.writeFileSync('./public/400.html', '<p>Wat?</p>');
      fs.writeFileSync('./public/404.html', '<p>Not here</p>');

      let e1 = await request('/%E0%A4%A').catch(e => e.response);
      let e2 = await request('/foobar').catch(e => e.response);

      expect(e1.body).toEqual('<p>Wat?</p>');
      expect(e2.body).toEqual('<p>Not here</p>');
    });

    it('does not serve content when other routes match', async () => {
      let handler = (req, res) => res.json(req.params);

      server.route('/foo{:ext}', handler);
      server.serve('./public');
      server.route('/foo/:path', handler);

      await expectAsync(request('/index.html')).toBeResolvedTo('<p>test</p>');
      await expectAsync(request('/foo.html')).toBeResolvedTo({ ext: '.html' });
      await expectAsync(request('/foo/bar.html')).toBeResolvedTo({ path: 'bar.html' });
      await expectAsync(request('/foo/bar')).toBeResolvedTo({ path: 'bar' });
    });

    it('does not serve content from an unsatisfiable byte range', async () => {
      server.serve('./public');

      let [body, res] = await request('/foo/bar.html', {
        headers: { Range: 'bytes=1000-2000' }
      }, true);

      expect(res.statusCode).toBe(416);
      expect(res.headers).toHaveProperty('content-range', 'bytes */14');
      expect(body).toEqual('');
    });

    it('does not serve content from an invalid byte range', async () => {
      server.serve('./public');

      let [body, res] = await request('/foo/bar.html', {
        headers: { Range: 'bites=a-b' }
      }, true);

      expect(res.statusCode).toBe(416);
      expect(res.headers).toHaveProperty('content-range', 'bytes */14');
      expect(body).toEqual('');
    });

    it('protects against path traversal', async () => {
      server.serve('./public');
      fs.writeFileSync('./secret', '*wags finger* ☝️');
      // by encoding `../` we can sneak past `new URL().pathname` sanitization
      await expectAsync(request('/%2E%2E%2Fsecret')).toBeRejectedWithError('400 Bad Request');
    });
  });
});
