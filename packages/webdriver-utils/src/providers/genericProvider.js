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

    const percyCSS = this.options.percyCSS || '';
    await this.addPercyCSS(percyCSS);
    const tag = await this.getTag();

    const tiles = await this.getTiles(fullscreen);
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

  async getTiles(fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    const base64content = await this.driver.takeScreenshot();
    return {
      tiles: [
        new Tile({
          content: base64content,
          // TODO: Need to add method to fetch these attr
          statusBarHeight: 0,
          navBarHeight: 0,
          headerHeight: 0,
          footerHeight: 0,
          fullscreen
        })
      ],
      // TODO: Add Generic support sha for contextual diff
      domInfoSha: this.getDomContent()
    };
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

  // TODO: Add Debugging Url
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
        const ignoredRegion = await this.getRegionObject(selector, element[Object.keys(element)[0]]);
        regionsArray.push(ignoredRegion);
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

        const ignoredRegion = await this.getRegionObject(selector, elements[index]);
        regionsArray.push(ignoredRegion);
      } catch (e) {
        log.warn(`Correct Web Element not passed at index ${index}.`);
        log.debug(e.toString());
      }
    }
    return regionsArray;
  }

  async getSeleniumRegionsByLocation(customLocations) {
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
