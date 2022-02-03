// aliased to src for coverage during tests without needing to compile this file
const { default: Server } = require('@percy/core/dist/server');

function createTestServer({ default: defaultReply, ...replies }, port = 8000) {
  let server = new Server();

  // alternate route registration
  server.reply = (p, cb) => (replies[p] = cb);

  // track requests and route replies
  server.requests = [];
  server.route(async (req, res, next) => {
    let { url: { pathname } } = req;
    let reply = replies[pathname] ?? defaultReply;
    server.requests.push(req.body ? [pathname, req.body] : [pathname]);
    return reply ? res.send(...await reply(req)) : next();
  });

  // automatically listen
  return server.listen(port);
};

// support commonjs environments
module.exports = createTestServer;
module.exports.createTestServer = createTestServer;
