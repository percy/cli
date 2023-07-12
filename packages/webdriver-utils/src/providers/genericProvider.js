import utils from '@percy/sdk-utils';

import MetaDataResolver from '../metadata/metaDataResolver.js';
import Tile from '../util/tile.js';
import Driver from '../driver.js';
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

  defaultPercyCSS() {
    return `*, *::before, *::after {
      -moz-transition: none !important;
      transition: none !important;
      -moz-animation: none !important;
      animation: none !important;
      animation-duration: 0 !important;
      caret-color: transparent !important;
      content-visibility: visible !important;
    }
    html{
      scrollbar-width: auto !important;
    }
    svg {
      shape-rendering: geometricPrecision !important;
    }
    scrollbar, scrollcorner, scrollbar thumb, scrollbar scrollbarbutton {
      pointer-events: none !important;
      -moz-appearance: none !important;
      display: none !important;
    }
    video::-webkit-media-controls {
      display: none !important;
    }`;
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

  async addPercyCSS(userCSS) {
    const createStyleElement = `const e = document.createElement('style');
      e.setAttribute('data-percy-specific-css', true);
      e.innerHTML = '${userCSS}';
      document.body.appendChild(e);`;
    await this.driver.executeScript({ script: createStyleElement, args: [] });
  }

  async removePercyCSS() {
    const removeStyleElement = `const n = document.querySelector('[data-percy-specific-css]');
      n.remove();`;
    await this.driver.executeScript({ script: removeStyleElement, args: [] });
  }

  async screenshot(name, {
    ignoreRegionXpaths = [],
    ignoreRegionSelectors = [],
    ignoreRegionElements = [],
    customIgnoreRegions = []
  }) {
    let fullscreen = false;

    this.addDefaultOptions();

    const percyCSS = (this.defaultPercyCSS() + (this.options.percyCSS || '')).split('\n').join('');
    await this.addPercyCSS(percyCSS);
    const tag = await this.getTag();

    const tiles = await this.getTiles(this.header, this.footer, fullscreen);
    const ignoreRegions = await this.findIgnoredRegions(
      ignoreRegionXpaths, ignoreRegionSelectors, ignoreRegionElements, customIgnoreRegions
    );
    await this.setDebugUrl();
    await this.removePercyCSS();

    log.debug(`${name} : Tag ${JSON.stringify(tag)}`);
    log.debug(`${name} : Tiles ${JSON.stringify(tiles)}`);
    log.debug(`${name} : Debug url ${this.debugUrl}`);
    return {
      name,
      tag,
      tiles: tiles.tiles,
      // TODO: Fetch this one for bs automate, check appium sdk
      externalDebugUrl: this.debugUrl,
      ignoredElementsData: ignoreRegions,
      environmentInfo: [...this.environmentInfo].join('; '),
      clientInfo: [...this.clientInfo].join(' '),
      domInfoSha: tiles.domInfoSha
    };
  }

  // TODO: get dom sha for non-automate
  async getDomContent() {
    // execute script and return dom content
    return 'dummyValue';
  }

  async getTiles(headerHeight, footerHeight, fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    const base64content = await this.driver.takeScreenshot();
    log.debug('Tiles captured successfully');
    return {
      tiles: [
        new Tile({
          content: base64content,
          // TODO: Need to add method to fetch these attr
          statusBarHeight: 0,
          navBarHeight: 0,
          headerHeight,
          footerHeight,
          fullscreen
        })
      ],
      // TODO: Add Generic support sha for contextual diff
      domInfoSha: await this.getDomContent()
    };
  }

  async getTag() {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    let { width, height } = await this.metaData.windowSize();
    const resolution = await this.metaData.screenResolution();
    const orientation = this.metaData.orientation();
    [this.header, this.footer] = await this.getHeaderFooter();
    // for android window size only constitutes of browser viewport, hence adding nav / status / url bar heights
    height = this.capabilities.platformName && this.capabilities.platformName.toLowerCase() === 'android' ? height + this.header + this.footer : height;
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

  // TODO: Add Debugging Url
  async setDebugUrl() {
    this.debugUrl = 'https://localhost/v1';
  }

  async findIgnoredRegions(ignoreRegionXpaths, ignoreRegionSelectors, ignoreRegionElements, customIgnoreRegions) {
    const ignoreElementXpaths = await this.getIgnoreRegionsBy('xpath', ignoreRegionXpaths);
    const ignoreElementSelectors = await this.getIgnoreRegionsBy('css selector', ignoreRegionSelectors);
    const ignoreElements = await this.getIgnoreRegionsByElement(ignoreRegionElements);
    const ignoreElementCustom = await this.getCustomIgnoreRegions(customIgnoreRegions);

    return {
      ignoreElementsData: [
        ...ignoreElementXpaths,
        ...ignoreElementSelectors,
        ...ignoreElements,
        ...ignoreElementCustom
      ]
    };
  }

  async ignoreElementObject(selector, elementId) {
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

  async getIgnoreRegionsBy(findBy, elements) {
    const ignoredElementsArray = [];
    for (const idx in elements) {
      try {
        const element = await this.driver.findElement(findBy, elements[idx]);
        const selector = `${findBy}: ${elements[idx]}`;
        const ignoredRegion = await this.ignoreElementObject(selector, element[Object.keys(element)[0]]);
        ignoredElementsArray.push(ignoredRegion);
      } catch (e) {
        log.warn(`Selenium Element with ${findBy}: ${elements[idx]} not found. Ignoring this ${findBy}.`);
        log.error(e.toString());
      }
    }
    return ignoredElementsArray;
  }

  async getIgnoreRegionsByElement(elements) {
    const ignoredElementsArray = [];
    for (let index = 0; index < elements.length; index++) {
      try {
        const selector = `element: ${index}`;

        const ignoredRegion = await this.ignoreElementObject(selector, elements[index]);
        ignoredElementsArray.push(ignoredRegion);
      } catch (e) {
        log.warn(`Correct Web Element not passed at index ${index}.`);
        log.debug(e.toString());
      }
    }
    return ignoredElementsArray;
  }

  async getCustomIgnoreRegions(customLocations) {
    const ignoredElementsArray = [];
    const { width, height } = await this.metaData.windowSize();
    for (let index = 0; index < customLocations.length; index++) {
      const customLocation = customLocations[index];
      const invalid = customLocation.top >= height || customLocation.bottom > height || customLocation.left >= width || customLocation.right > width;

      if (!invalid) {
        const selector = `custom ignore region ${index}`;
        const ignoredRegion = {
          selector,
          coOrdinates: {
            top: customLocation.top,
            bottom: customLocation.bottom,
            left: customLocation.left,
            right: customLocation.right
          }
        };
        ignoredElementsArray.push(ignoredRegion);
      } else {
        log.warn(`Values passed in custom ignored region at index: ${index} is not valid`);
      }
    }
    return ignoredElementsArray;
  }

  async getHeaderFooter() {
    const devicesConfig = (await request(DEVICES_CONFIG_URL)).body;
    let deviceKey = `${this.metaData.deviceName()}-${this.metaData.osVersion()}`;
    let browserName = this.capabilities.browserName;
    return devicesConfig[deviceKey]
      ? (
          devicesConfig[deviceKey][browserName]
            ? [devicesConfig[deviceKey][browserName].header, devicesConfig[deviceKey][browserName].footer]
            : [0, 0]
        ) : [0, 0];
  }
}
