const utils = require('@percy/sdk-utils');

const helpers = {
  async setupTest() {
    utils.percy.version = '';
    delete utils.percy.config;
    delete utils.percy.enabled;
    delete utils.percy.domScript;
    delete utils.logger.log.history;
    delete utils.logger.loglevel.lvl;
    delete process.env.PERCY_LOGLEVEL;
    delete process.env.PERCY_SERVER_ADDRESS;
    await helpers.test('reset');
    await utils.logger.remote();
  },

  async test(cmd, arg) {
    let res = await utils.request.post(`/test/api/${cmd}`, arg);
    return res.body;
  },

  async get(what, map) {
    let res = await utils.request(`/test/${what}`);
    if (!map) map = what === 'logs' ? (l => l.message) : (i => i);
    return Array.isArray(res.body[what]) ? res.body[what].map(map) : map(res.body);
  },

  get testSnapshotURL() {
    return `${utils.percy.address}/test/snapshot`;
  }
};

module.exports = helpers;
