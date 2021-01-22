const createTestServer = require('@percy/core/test/helpers/server');
const logger = require('@percy/logger/test/helper');
const sdk = { logger };

// mock serialization script
const serializeDOM = (options) => {
  let { dom = document, domTransformation } = options || {};
  let doc = (dom || document).documentElement;
  if (domTransformation) domTransformation(doc);
  return doc.outerHTML;
};

sdk.setup = async function setup() {
  // mock percy server
  sdk.server = await createTestServer({
    '/percy/dom.js': () => [200, 'application/javascript', (
      `window.PercyDOM = { serialize: ${sdk.serializeDOM.toString()} }`)],
    '/percy/healthcheck': () => [200, 'application/json', (
      { success: true, config: { snapshot: { widths: [1280] } } })],
    '/percy/snapshot': () => [200, 'application/json', { success: true }]
  }, 5338);

  // reset things
  delete process.env.PERCY_CLI_API;
  delete process.env.PERCY_LOGLEVEL;
  sdk.serializeDOM = serializeDOM;
  logger.mock();

  let utils = require('..');
  delete utils.getInfo.version;
  delete utils.getInfo.config;
  delete utils.isPercyEnabled.result;
  delete utils.fetchPercyDOM.result;
};

sdk.teardown = async function teardown() {
  await sdk.server.close();
};

sdk.rerequire = function rerequire(module) {
  delete require.cache[require.resolve(module)];
  return require(module);
};

sdk.test = {
  failure: (path, error) => sdk.server.reply(path, () => (
    [500, 'application/json', { success: false, error }])),
  error: path => sdk.server.reply(path, r => r.connection.destroy())
};

sdk.testsite = {
  mock: async () => {
    sdk.testsite = await createTestServer({
      default: () => [200, 'text/html', 'Snapshot Me']
    });
  }
};

module.exports = sdk;
