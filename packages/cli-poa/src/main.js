import { WebDriver } from 'selenium-webdriver';
import { HttpClient, Executor } from 'selenium-webdriver/http/index.js';
import fs from 'fs';
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
  driver2 = null;
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
    this.metaData = {};
    this.createDriver();
    this.createDriver2();
    this.takeScreenshot();
  }

  createDriver() {
    this.driver = new WebDriver(
      this.sessionId,
      new Executor(Promise.resolve(this.commandExecutorUrl).then(url => new HttpClient(this.commandExecutorUrl, null, null))));
  }

  async createDriver2() {
    this.driver2 = new Driver(this.sessionId, this.commandExecutorUrl);
    const caps = await this.driver2.helper.getCapabilites();
    console.log(caps);
    this.commonMetaData = await CommonMetaDataResolver.resolve(this.driver2, caps.value, this.capabilities);
  }

  async takeScreenshot() {
    await this.localScreenshot();
  }

  async localScreenshot() {
    // const metaObj = new MetaDataResolver();
    // this.metaData = await metaObj.resolve(this.capabilities);
    const fileName = `./outScreenshot_${this.snapshotName}.png`;
    this.driver.takeScreenshot().then(
      function(image, err) {
        fs.writeFile(fileName, image, 'base64', function(err) {
          console.log(err);
        });
      }
    ).then(() => {
      this.triggerAppPercy();
    });
  }

  async triggerAppPercy() {
    // const app = new AppiumDriver(this.driver);
    this.percyScreenshot(this.snapshotName);
  }

  async getTag() {
    const { width, height } = await this.metaData.screenSize();
    const orientation = (await this.metaData.orientation());
    return {
      name: await this.metaData.deviceName() || 'unknown',
      osName: await this.metaData.osName() || 'unknown',
      osVersion: await this.metaData.osVersion(),
      width,
      height,
      orientation: orientation
    };
  }

  async getTag1() {
    const { width, height } = await this.commonMetaData.windowSize();
    const orientation = (await this.commonMetaData.orientation());
    return {
      name: await this.commonMetaData.deviceName() || 'unknown',
      osName: await this.commonMetaData.osName() || 'unknown',
      osVersion: await this.commonMetaData.osVersion(),
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
    const tag = await this.getTag1();
    console.log(tag);
    const tiles = this.getTiles();
    const eUrl = 'https://localhost/v1';
    return await postComparison({
      name,
      tag,
      tiles,
      externalDebugUrl: eUrl,
      environmentInfo: 'staging-poc-poa',
      clientInfo: 'local-poc-poa'
    });
  }
}
