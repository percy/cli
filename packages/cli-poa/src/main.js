import fs from 'fs/promises';
import { postComparison } from '@percy/sdk-utils';
import Driver from './driverResolver/driver.js';
import CommonMetaDataResolver from './metadata/commonMetaDataResolver.js';

class Tile {
  constructor({
    filepath,
    statusBarHeight,
    navBarHeight,
    headerHeight,
    footerHeight,
    fullscreen,
    sha
  }) {
    this.filepath = filepath;
    this.statusBarHeight = statusBarHeight;
    this.navBarHeight = navBarHeight;
    this.headerHeight = headerHeight;
    this.footerHeight = footerHeight;
    this.fullscreen = fullscreen;
    this.sha = sha;
  }
}

export default class PoaDriver {
  sessionId = '';
  commandExecutorUrl = '';
  capabilities = {};
  driver = null;
  constructor(
    sessionId,
    commandExecutorUrl,
    capabilities,
    snapshotName,
    sessionCapabilites
  ) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.snapshotName = snapshotName;
    this.sessionCapabilites = sessionCapabilites;
  }

  async createDriver() {
    this.driver = new Driver(this.sessionId, this.commandExecutorUrl);
    const caps = await this.driver.helper.getCapabilites();
    this.commonMetaData = await CommonMetaDataResolver.resolve(this.driver, caps.value, this.capabilities);
  }

  takeScreenshot() {
    // takeScreenshot is a wrapper function to implement multiple screenshot techniques
    return this.localScreenshot();
  }

  async localScreenshot() {
    const fileName = `./outScreenshot_${this.snapshotName}.png`;
    const imageBase64 = await this.driver.helper.takeScreenshot();
    await fs.writeFile(fileName, imageBase64.value, 'base64');
    return this.percyScreenshot(this.snapshotName);
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

  getTiles() {
    const path = `./outScreenshot_${this.snapshotName}.png`;
    const fullscreen = false;
    return [
      new Tile({
        filepath: path,
        statusBarHeight: 0,
        navBarHeight: 0,
        headerHeight: 0,
        footerHeight: 0,
        fullscreen
      })
    ];
  }

  async percyScreenshot(name) {
    const tag = await this.getTag();
    const tiles = this.getTiles();
    const eUrl = 'https://localhost/v1';
    return postComparison({
      name,
      tag,
      tiles,
      externalDebugUrl: eUrl,
      environmentInfo: 'staging-poc-poa',
      clientInfo: 'local-poc-poa'
    });
  }
}
