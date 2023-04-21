import utils from '@percy/sdk-utils'
import tmp from 'tmp'
import fs from 'fs/promises'

import CommonMetaDataResolver from '../metadata/commonMetaDataResolver.js';
import log from '../util/log.js'
import Tile from '../util/tile.js'
import Driver from '../driver.js';

// TODO: Need to pass parameter from sdk and catch in cli
const CLIENT_INFO = `local-poc-poa`
const ENV_INFO = `staging-poc-poa`

export default class GenericProvider {
  constructor(
    sessionId,
    commandExecutorUrl,
    capabilities,
    sessionCapabilites
  ) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.sessionCapabilites = sessionCapabilites;
    this.driver = null;
    this.commonMetaData = null;
    this.debugUrl = null;
  }

  async createDriver() {
    this.driver = new Driver(this.sessionId, this.commandExecutorUrl);
    const caps = await this.driver.getCapabilites();
    this.commonMetaData = await CommonMetaDataResolver.resolve(this.driver, caps.value, this.capabilities);
  }

  static supports(_commandExecutorUrl) {
    return true;
  }

  async screenshot(name) {
    let fullscreen = false;

    const tag = await this.getTag();
    const tiles = await this.getTiles(fullscreen);
    await this.setDebugUrl();

    log.debug(`${name} : Tag ${JSON.stringify(tag)}`);
    log.debug(`${name} : Tiles ${JSON.stringify(tiles)}`);
    log.debug(`${name} : Debug url ${this.debugUrl}`);
    return await utils.postComparison({
      name,
      tag,
      tiles,
      // TODO: Fetch this one for bs automate, check appium sdk
      externalDebugUrl: this.debugUrl,
      environmentInfo: ENV_INFO,
      clientInfo: CLIENT_INFO
    });
  }

  async getTiles(fullscreen) {
    const base64content = await this.driver.takeScreenshot();
    const path = await this.writeTempImage(base64content.value);
    return [
      new Tile({
        filepath: path,
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
    const { width, height } = await this.commonMetaData.windowSize();
    const orientation = this.commonMetaData.orientation();
    return {
      name: this.commonMetaData.deviceName() || 'unknown',
      osName: this.commonMetaData.osName() || 'unknown',
      osVersion: this.commonMetaData.osVersion(),
      width,
      height,
      orientation: orientation
    };
  }

  async writeTempImage(base64content) {
    const path = await this.tempFile();
    const buffer = Buffer.from(base64content, 'base64');
    await fs.writeFile(path, buffer);
    return path;
  }

  // this creates a temp file and closes descriptor
  async tempFile() {
    const percyTmpDir = process.env.PERCY_TMP_DIR;
    if (percyTmpDir) {
      // this does not throw for existing directory if recursive is true
      await fs.mkdir(percyTmpDir, { recursive: true });
    }
    return await new Promise((resolve, reject) => {
      tmp.file({
        mode: 0o644,
        tmpdir: percyTmpDir,
        prefix: 'percy-',
        postfix: '.png',
        discardDescriptor: true
      }, (err, path) => {
        /* istanbul ignore next */ // hard to test
        if (err) reject(err);
        resolve(path);
      });
    });
  }

  async setDebugUrl() {
    this.debugUrl = 'https://localhost/v1';
  }
}
