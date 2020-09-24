import { createServer } from 'http';

export default function createTestServer(replies = {}, port = 8000) {
  let server = createServer((request, response) => {
    request.on('data', chunk => {
      request.body = (request.body || '') + chunk;
    });

    request.on('end', async () => {
      try { request.body = JSON.parse(request.body); } catch {}
      server.requests.push([request.url, request.body]);

      let reply = server.replies[request.url] || server.replies['*'];
      let [status, headers, body] = reply ? await reply(request) : [404, {}];

      if (typeof headers === 'string') headers = { 'Content-Type': headers };
      if (body) headers['Content-Length'] = body.length;

      response.writeHead(status, headers).end(body);
    });
  });

  server.reply = (url, handler) => {
    server.replies[url] = handler;
    return server;
  };

  server.requests = [];
  server.replies = replies;

  return new Promise((resolve, reject) => {
    server.on('listening', () => resolve(server));
    server.on('error', reject);
    server.listen(port);
  });
}
