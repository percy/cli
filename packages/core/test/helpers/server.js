// aliased to src for coverage during tests without needing to compile this file
const { createServer } = require('@percy/core/dist/server');

module.exports = function createTestServer(routes, port = 8000) {
  let onError = ({ message }) => [500, 'text/plain', message];
  let middleware = ({ url, body }) => server.requests.push(body ? [url, body] : [url]);
  let server = createServer({ ...routes, middleware, catch: onError });
  server.requests = [];

  return server.listen(port);
};
