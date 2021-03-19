const logger = require('@percy/logger/test/helpers');
const utils = require('@percy/sdk-utils');

const helpers = {
  logger,

  async setup() {
    utils.percy.version = '';
    delete utils.percy.config;
    delete utils.percy.enabled;
    delete utils.percy.domScript;
    delete process.env.PERCY_SERVER_ADDRESS;
    await helpers.call('server.mock');
    logger.mock();
  },

  teardown: () => helpers.call('server.close'),
  getRequests: () => helpers.call('server.requests'),
  testReply: (path, reply) => helpers.call('server.reply', path, reply),
  testFailure: (path, error) => helpers.call('server.test.failure', path, error),
  testError: path => helpers.call('server.test.error', path),
  testSerialize: fn => helpers.call('server.test.serialize', fn && fn.toString()),
  mockSite: () => helpers.call('site.mock'),
  closeSite: () => helpers.call('site.close')
};

if (process.env.__PERCY_BROWSERIFIED__) {
  helpers.call = async function call(event, ...args) {
    let { socket, pending = {} } = helpers.call;

    if (!socket) {
      socket = new window.WebSocket('ws://localhost:5339');

      await new Promise((resolve, reject) => {
        let done = event => {
          clearTimeout(timeoutid);
          socket.onopen = socket.onerror = null;
          if (event && (event.error || event.type === 'error')) {
            reject(event.error || new Error('Test client connection failed'));
          } else resolve(socket);
        };

        let timeoutid = setTimeout(done, 1000, {
          error: new Error('Test client connection timed out')
        });

        socket.onopen = socket.onerror = done;
      });

      socket.onmessage = ({ data }) => {
        let { id, resolve, reject } = JSON.parse(data);
        if (!pending[id]) return;
        if (resolve) pending[id].resolve(resolve.result);
        if (reject) pending[id].reject(reject.error);
      };

      Object.assign(helpers.call, { socket, pending });
    }

    let id = helpers.call.uid = (helpers.call.uid || 0) + 1;
    args = args.map(a => typeof a === 'function' ? a.toString() : a);
    socket.send(JSON.stringify({ id, event, args }));

    return ((pending[id] = {}).promise = (
      new Promise((resolve, reject) => {
        Object.assign(pending[id], { resolve, reject });
      })
    ));
  };
} else {
  helpers.context = require('./server').context();
  helpers.call = helpers.context.call;
}

module.exports = helpers;
