const createTestServer = require('@percy/core/test/helpers/server');
const sdk = {};

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
  sdk.stdio[1] = []; sdk.stdio[2] = [];

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

sdk.stdio = function stdio(fn, { colors = false } = {}) {
  // eslint-disable-next-line no-control-regex
  let format = s => colors ? s : s.replace(/\x1B\[\d+m/g, '');
  let out = process.stdout.write;
  let err = process.stderr.write;
  let r, e;

  let done = (r, e) => {
    process.stdout.write = out;
    process.stderr.write = err;
    if (e) throw e;
    return r;
  };

  process.stdout.write = s => stdio[1].push(format(s));
  process.stderr.write = s => stdio[2].push(format(s));
  try { r = fn(); } catch (err) { e = err; }

  if (!e && r && typeof r.then === 'function') {
    return r.then(done, e => done(r, e));
  } else {
    return done(r, e);
  }
};

module.exports = sdk;
