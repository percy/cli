import { createServer } from '../../src/server';

export default function createTestServer(routes, port = 8000) {
  let middleware = ({ url, body }) => server.requests.push([url, body]);
  let server = createServer({ ...routes, middleware });
  server.requests = [];

  return server.listen(port);
}
