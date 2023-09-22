import utils from '@percy/sdk-utils';

import MetaDataResolver from '../metadata/metaDataResolver.js';
import Tile from '../util/tile.js';
import Driver from '../driver.js';
import Cache from '../util/cache.js';
const { request } = utils;

const DEVICES_CONFIG_URL = 'https://storage.googleapis.com/percy-utils/devices.json';
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
    options,
    buildInfo
  ) {
    this.sessionId = sessionId;
    this.commandExecutorUrl = commandExecutorUrl;
    this.capabilities = capabilities;
    this.sessionCapabilites = sessionCapabilites;
    this.addClientInfo(clientInfo);
    this.addEnvironmentInfo(environmentInfo);
    this.options = options;
    this.buildInfo = buildInfo;
    this.driver = null;
    this.metaData = null;
    this.debugUrl = null;
    this.header = 0;
    this.footer = 0;
  }

  addDefaultOptions() {
    this.options.freezeAnimation = this.options.freezeAnimation || false;
  }

  async createDriver() {
    this.driver = new Driver(this.sessionId, this.commandExecutorUrl, this.capabilities);
    log.debug(`Passed capabilities -> ${JSON.stringify(this.capabilities)}`);
    const caps = await this.driver.getCapabilites();
    log.debug(`Fetched capabilities -> ${JSON.stringify(caps)}`);
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

  async screenshot(name, {
    ignoreRegionXpaths = [],
    ignoreRegionSelectors = [],
    ignoreRegionElements = [],
    customIgnoreRegions = [],
    considerRegionXpaths = [],
    considerRegionSelectors = [],
    considerRegionElements = [],
    customConsiderRegions = []
  }) {
    let fullscreen = false;

    this.addDefaultOptions();

    this.options.percyCSS = (this.options.percyCSS || '').split('\n').join('');

    log.debug('Fetching comparisong tag ...');
    const tag = await this.getTag();
    log.debug(`[${name}] : Tag ${JSON.stringify(tag)}`);

    const tiles = await this.getTiles(this.header, this.footer, fullscreen);
    log.debug(`[${name}] : Tiles ${JSON.stringify(tiles)}`);

    const ignoreRegions = await this.findRegions(
      ignoreRegionXpaths, ignoreRegionSelectors, ignoreRegionElements, customIgnoreRegions
    );
    const considerRegions = await this.findRegions(
      considerRegionXpaths, considerRegionSelectors, considerRegionElements, customConsiderRegions
    );
    await this.setDebugUrl();
    log.debug(`[${name}] : Debug url ${this.debugUrl}`);

    return {
      name,
      tag,
      tiles: tiles.tiles,
      // TODO: Fetch this one for bs automate, check appium sdk
      externalDebugUrl: this.debugUrl,
      ignoredElementsData: {
        ignoreElementsData: ignoreRegions
      },
      consideredElementsData: {
        considerElementsData: considerRegions
      },
      environmentInfo: [...this.environmentInfo].join('; '),
      clientInfo: [...this.clientInfo].join(' '),
      domInfoSha: tiles.domInfoSha,
      metadata: tiles.metadata || null
    };
  }

  // TODO: get dom sha for non-automate
  async getDomContent() {
    // execute script and return dom content
    return 'dummyValue';
  }

  async getWindowHeight() {
    // execute script and return window height
    return await this.driver.executeScript({ script: 'return window.innerHeight', args: [] }); ;
  }

  async getTiles(headerHeight, footerHeight, fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    const base64content = await this.driver.takeScreenshot();
    log.debug('Tiles captured successfully');
    return {
      tiles: [
        new Tile({
          content: base64content,
          statusBarHeight: 0,
          navBarHeight: 0,
          headerHeight,
          footerHeight,
          fullscreen
        })
      ],
      // TODO: Add Generic support sha for contextual diff for non-automate
      domInfoSha: await this.getDomContent(),
      metadata: {
        windowHeight: await this.getWindowHeight()
      }
    };
  }

  async getTag() {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    let { width, height } = await this.metaData.windowSize();
    const resolution = await this.metaData.screenResolution();
    const orientation = this.metaData.orientation();
    [this.header, this.footer] = await this.getHeaderFooter();
    // for android window size only constitutes of browser viewport, hence adding nav / status / url bar heights
    height = this.metaData.osName() === 'android' ? height + this.header + this.footer : height;
    return {
      name: this.metaData.deviceName(),
      osName: this.metaData.osName(),
      osVersion: this.metaData.osVersion(),
      width,
      height,
      orientation: orientation,
      browserName: this.metaData.browserName(),
      browserVersion: this.metaData.browserVersion(),
      resolution: resolution
    };
  }

  // TODO: Add Debugging Url for non-automate
  async setDebugUrl() {
    this.debugUrl = 'https://localhost/v1';
  }

  async findRegions(xpaths, selectors, elements, customLocations) {
    const xpathRegions = await this.getSeleniumRegionsBy('xpath', xpaths);
    const selectorRegions = await this.getSeleniumRegionsBy('css selector', selectors);
    const elementRegions = await this.getSeleniumRegionsByElement(elements);
    const customRegions = await this.getSeleniumRegionsByLocation(customLocations);

    return [
      ...xpathRegions,
      ...selectorRegions,
      ...elementRegions,
      ...customRegions
    ];
  }

  async getRegionObject(selector, elementId) {
    const scaleFactor = parseInt(await this.metaData.devicePixelRatio());
    const rect = await this.driver.rect(elementId);
    const location = { x: rect.x, y: rect.y };
    const size = { height: rect.height, width: rect.width };
    const coOrdinates = {
      top: Math.floor(location.y * scaleFactor),
      bottom: Math.ceil((location.y + size.height) * scaleFactor),
      left: Math.floor(location.x * scaleFactor),
      right: Math.ceil((location.x + size.width) * scaleFactor)
    };

    const jsonObject = {
      selector,
      coOrdinates
    };

    return jsonObject;
  }

  async getSeleniumRegionsBy(findBy, elements) {
    const regionsArray = [];
    for (const idx in elements) {
      try {
        const element = await this.driver.findElement(findBy, elements[idx]);
        const selector = `${findBy}: ${elements[idx]}`;
        const region = await this.getRegionObject(selector, element[Object.keys(element)[0]]);
        regionsArray.push(region);
      } catch (e) {
        log.warn(`Selenium Element with ${findBy}: ${elements[idx]} not found. Ignoring this ${findBy}.`);
        log.error(e.toString());
      }
    }
    return regionsArray;
  }

  async getSeleniumRegionsByElement(elements) {
    const regionsArray = [];
    for (let index = 0; index < elements.length; index++) {
      try {
        const selector = `element: ${index}`;

        const region = await this.getRegionObject(selector, elements[index]);
        regionsArray.push(region);
      } catch (e) {
        log.warn(`Correct Web Element not passed at index ${index}.`);
        log.debug(e.toString());
      }
    }
    return regionsArray;
  }

  async getSeleniumRegionsByLocation(customLocations) {
    const elementsArray = [];
    const { width, height } = await this.metaData.windowSize();
    for (let index = 0; index < customLocations.length; index++) {
      const customLocation = customLocations[index];
      const invalid = customLocation.top >= height || customLocation.bottom > height || customLocation.left >= width || customLocation.right > width;

      if (!invalid) {
        const selector = `custom region ${index}`;
        const region = {
          selector,
          coOrdinates: {
            top: customLocation.top,
            bottom: customLocation.bottom,
            left: customLocation.left,
            right: customLocation.right
          }
        };
        elementsArray.push(region);
      } else {
        log.warn(`Values passed in custom ignored region at index: ${index} is not valid`);
      }
    }
    return elementsArray;
  }

  async getHeaderFooter(deviceName, osVersion, browserName) {
    // passing 0 as key, since across different pages and tests, this config will remain same
    const devicesConfig = await Cache.withCache(Cache.devicesConfig, 0, async () => {
      return (await request(DEVICES_CONFIG_URL)).body;
    });
    let deviceKey = `${deviceName}-${osVersion}`;
    return devicesConfig[deviceKey]
      ? (
          devicesConfig[deviceKey][browserName]
            ? [devicesConfig[deviceKey][browserName].header, devicesConfig[deviceKey][browserName].footer]
            : [0, 0]
        ) : [0, 0];
  }
}
