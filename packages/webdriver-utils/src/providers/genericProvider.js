import utils from '@percy/sdk-utils';

import MetaDataResolver from '../metadata/metaDataResolver.js';
import Tile from '../util/tile.js';
import Driver from '../driver.js';

const log = utils.logger('webdriver-utils:genericProvider');
// TODO: Need to pass parameter from sdk and catch in cli
const CLIENT_INFO = 'local-poc-poa';
const ENV_INFO = 'staging-poc-poa';

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

  async screenshot(name, {
    ignoreRegionXpaths,
    ignoreRegionSelectors,
    ignoreRegionSeleniumElements,
    customIgnoreRegions
  }) {
    let fullscreen = false;

    const tag = await this.getTag();
    const tiles = await this.getTiles(fullscreen);
    const ignoreRegions = await this.findIgnoredRegions(
      ignoreRegionXpaths, ignoreRegionSelectors, ignoreRegionSeleniumElements, customIgnoreRegions
    );
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
      ignoredElementsData: ignoreRegions,
      environmentInfo: ENV_INFO,
      clientInfo: CLIENT_INFO
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
      // TODO
      browserVersion: 'unknown'
    };
  }

  async setDebugUrl() {
    this.debugUrl = 'https://localhost/v1';
  }

  async findIgnoredRegions(ignoreRegionXpaths, ignoreRegionSelectors, ignoreRegionSeleniumElements, customIgnoreRegions) {
    const ignoredElementsArray = [];
    await this.ignoreRegionsByXpaths(ignoredElementsArray, ignoreRegionXpaths || []);
    await this.ignoreRegionsBySelector(ignoredElementsArray, ignoreRegionSelectors || []);
    await this.ignoreRegionsByElement(ignoredElementsArray, ignoreRegionSeleniumElements || []);
    await this.addCustomIgnoreRegions(ignoredElementsArray, customIgnoreRegions || []);

    const ignoredElementsLocations = {
      ignoreElementsData: ignoredElementsArray
    };

    return ignoredElementsLocations;
  }

  async ignoreElementObject(selector, elementId) {
    const scaleFactor = await this.metaData.devicePixelRatio();
    const rect = await this.driver.rect(elementId);
    const location = { x: parseInt(rect.x), y: parseInt(rect.y) };
    const size = { height: parseInt(rect.height), width: parseInt(rect.width) };
    const coOrdinates = {
      top: location.y * scaleFactor,
      bottom: (location.y + size.height) * scaleFactor,
      left: location.x * scaleFactor,
      right: (location.x + size.width) * scaleFactor
    };

    const jsonObject = {
      selector,
      coOrdinates
    };

    return jsonObject;
  }

  async ignoreRegionsByXpaths(ignoredElementsArray, xpaths) {
    for (const xpath of xpaths) {
      try {
        const element = await this.driver.findElement('xpath', xpath);
        const selector = `xpath: ${xpath}`;
        const ignoredRegion = await this.ignoreElementObject(selector, element.ELEMENT);
        ignoredElementsArray.push(ignoredRegion);
      } catch (e) {
        log.info(`Selenium Element with xpath: ${xpath} not found. Ignoring this xpath.`);
        log.debug(e.toString());
      }
    }
  }

  async ignoreRegionsBySelector(ignoredElementsArray, ids) {
    for (const id of ids) {
      try {
        const element = await this.driver.findElement('css selector', id);
        const selector = `id: ${id}`;
        const ignoredRegion = await this.ignoreElementObject(selector, element.ELEMENT);
        ignoredElementsArray.push(ignoredRegion);
      } catch (e) {
        log.info(`Selenium Element with id: ${id} not found. Ignoring this id.`);
        log.debug(e.toString());
      }
    }
  }

  async ignoreRegionsByElement(ignoredElementsArray, elements) {
    for (let index = 0; index < elements.length; index++) {
      try {
        const selector = `element: ${index}`;

        const ignoredRegion = await this.ignoreElementObject(selector, elements[index]);
        ignoredElementsArray.push(ignoredRegion);
      } catch (e) {
        log.info(`Correct Web Element not passed at index ${index}.`);
        log.debug(e.toString());
      }
    }
  }

  async addCustomIgnoreRegions(ignoredElementsArray, customLocations) {
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
        log.info(`Values passed in custom ignored region at index: ${index} is not valid`);
      }
    }
  }
}
