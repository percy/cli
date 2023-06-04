import utils from '@percy/sdk-utils';

import MetaDataResolver from '../metadata/metaDataResolver.js';
import Tile from '../util/tile.js';
import Driver from '../driver.js';

const log = utils.logger('webdriver-utils:genericProvider');

export default class GenericProvider {
  clientInfo = new Set();
  environmentInfo = new Set();
  options = {};
  constructor(
    sessionId,
    commandExecutorUrl,
    capabilities,
    sessionCapabilites,
    clientInfo,
    environmentInfo,
    options
  ) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.sessionCapabilites = sessionCapabilites;
    this.addClientInfo(clientInfo);
    this.addEnvironmentInfo(environmentInfo);
    this.options = options;
    this.driver = null;
    this.metaData = null;
    this.debugUrl = null;
  }

  async createDriver() {
    this.driver = new Driver(this.sessionId, this.commandExecutorUrl);
    const caps = await this.driver.getCapabilites();
    this.metaData = await MetaDataResolver.resolve(this.driver, caps, this.capabilities);
  }

  static supports(_commandExecutorUrl) {
    return true;
  }

  addClientInfo(info) {
    for (let i of [].concat(info)) {
      if (i) this.clientInfo.add(i);
    }
  }

  addEnvironmentInfo(info) {
    for (let i of [].concat(info)) {
      if (i) this.environmentInfo.add(i);
    }
  }

  async screenshot(name) {
    let fullscreen = false;

    const tag = await this.getTag();
    const tiles = await this.getTiles(fullscreen);
    await this.setDebugUrl();

    log.debug(`${name} : Tag ${JSON.stringify(tag)}`);
    log.debug(`${name} : Tiles ${JSON.stringify(tiles)}`);
    log.debug(`${name} : Debug url ${this.debugUrl}`);
    return {
      name,
      tag,
      tiles,
      // TODO: Fetch this one for bs automate, check appium sdk
      externalDebugUrl: this.debugUrl,
      environmentInfo: [...this.environmentInfo].join('; '),
      clientInfo: [...this.clientInfo].join(' ')
    };
  }

  async getTiles(fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    const base64content = await this.driver.takeScreenshot();
    return [
      new Tile({
        content: base64content,
        // TODO: Need to add method to fetch these attr
        statusBarHeight: 0,
        navBarHeight: 0,
        headerHeight: 0,
        footerHeight: 0,
        fullscreen
      })
    ];
  }

  async getTag() {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    const { width, height } = await this.metaData.windowSize();
    const orientation = this.metaData.orientation();
    return {
      name: this.metaData.deviceName(),
      osName: this.metaData.osName(),
      osVersion: this.metaData.osVersion(),
      width,
      height,
      orientation: orientation,
      browserName: this.metaData.browserName(),
      browserVersion: this.metaData.browserVersion()
    };
  }

  async setDebugUrl() {
    this.debugUrl = 'https://localhost/v1';
  }
}
