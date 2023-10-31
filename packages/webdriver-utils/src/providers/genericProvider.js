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
    this.statusBarHeight = 0;
    this.pageXShiftFactor = 0;
    this.pageYShiftFactor = 0;
    this.currentOperatingSystem = null;
    this.removeElementShiftFactor = 50000;
    this.initialScrollFactor = { value: [0, 0] };
  }

  addDefaultOptions() {
    this.options.freezeAnimation = this.options.freezeAnimatedImage || this.options.freezeAnimation || false;
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

    this.currentOperatingSystem = tag.osName;
    this.statusBarHeight = tiles.tiles[0].statusBarHeight;

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

  async updatePageShiftFactor(location) {
    const scrollFactors = await this.driver.executeScript({ script: 'return [parseInt(window.scrollX * window.devicePixelRatio), parseInt(window.scrollY * window.devicePixelRatio)];', args: [] });
    this.pageYShiftFactor = this.currentOperatingSystem === 'iOS' ? this.statusBarHeight : (this.statusBarHeight - scrollFactors.value[1]);
    this.pageXShiftFactor = this.currentOperatingSystem === 'iOS' ? 0 : (-scrollFactors.value[0]);
    if (this.currentOperatingSystem === 'iOS') {
      console.log(scrollFactors, this.initialScrollFactor);
      if (scrollFactors.value[0] !== this.initialScrollFactor.value[0] || scrollFactors.value[1] !== this.initialScrollFactor.value[1]) {
        this.pageXShiftFactor = (-1 * this.removeElementShiftFactor);
        this.pageYShiftFactor = (-1 * this.removeElementShiftFactor);
      } else if (location.y === 0) {
        this.pageYShiftFactor += (-scrollFactors.value[1]);
      }
    }
  }

  async getRegionObject(selector, elementId) {
    const scaleFactor = await this.metaData.devicePixelRatio();
    const rect = await this.driver.rect(elementId);
    const location = { x: rect.x, y: rect.y };
    const size = { height: rect.height, width: rect.width };
    // Update pageShiftFactor Element is not visible in viewport
    // In case of iOS if the element is not visible in viewport it gives 0 for x-y coordinate.
    // In case of iOS if the element is partially visible it gives negative x-y coordinate.
    // Subtracting ScrollY/ScrollX ensures if the element is visible in viewport or not.
    await this.updatePageShiftFactor(location);
    const coOrdinates = {
      top: Math.floor(location.y * scaleFactor) + this.pageYShiftFactor,
      bottom: Math.ceil((location.y + size.height) * scaleFactor) + this.pageYShiftFactor,
      left: Math.floor(location.x * scaleFactor) + this.pageXShiftFactor,
      right: Math.ceil((location.x + size.width) * scaleFactor) + this.pageXShiftFactor
    };

    const jsonObject = {
      selector,
      coOrdinates
    };

    return jsonObject;
  }

  async getRegionObjectFromBoundingBox(selector, element) {
    const scaleFactor = await this.metaData.devicePixelRatio();
    let headerAdjustment = 0;
    if (this.currentOperatingSystem === 'iOS') {
      headerAdjustment = this.statusBarHeight;
    }
    const coOrdinates = {
      top: Math.floor(element.y * scaleFactor) + headerAdjustment,
      bottom: Math.ceil((element.y + element.height) * scaleFactor) + headerAdjustment,
      left: Math.floor(element.x * scaleFactor),
      right: Math.ceil((element.x + element.width) * scaleFactor)
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
        const boundingBoxRegion = await this.driver.findElementBoundingBox(findBy, elements[idx]);
        const selector = `${findBy}: ${elements[idx]}`;
        const region = await this.getRegionObjectFromBoundingBox(selector, boundingBoxRegion);
        regionsArray.push(region);
      } catch (e) {
        log.warn(`Selenium Element with ${findBy}: ${elements[idx]} not found. Ignoring this ${findBy}.`);
        log.error(e.toString());
      }
    }
    return regionsArray;
  }

  async getInitialPosition() {
    if (this.currentOperatingSystem === 'iOS') {
      this.initialScrollFactor = await this.driver.executeScript({ script: 'return [parseInt(window.scrollX * window.devicePixelRatio), parseInt(window.scrollY * window.devicePixelRatio)];', args: [] });
    }
  }

  async scrollToInitialPosition(x, y) {
    if (this.currentOperatingSystem === 'iOS') {
      await this.driver.executeScript({ script: `window.scrollTo(${x}, ${y})`, args: [] });
    }
  }

  async getSeleniumRegionsByElement(elements) {
    const regionsArray = [];
    await this.getInitialPosition();
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
    await this.scrollToInitialPosition(this.initialScrollFactor.value[0], this.initialScrollFactor.value[1]);
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
