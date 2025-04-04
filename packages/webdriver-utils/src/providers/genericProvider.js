import utils from '@percy/sdk-utils';
import TimeIt from '../util/timing.js';
import Tile from '../util/tile.js';
import Driver from '../driver.js';
import MetaDataResolver from '../metadata/metaDataResolver.js';
import NormalizeData from '../metadata/normalizeData.js';

const log = utils.logger('webdriver-utils:genericProvider');

export default class GenericProvider {
  clientInfoDetails = new Set();
  environmentInfoDetails = new Set();
  constructor(args) {
    Object.assign(this, args);
    this.addClientInfo(this.clientInfo);
    this.addEnvironmentInfo(this.environmentInfo);
    this._markedPercy = false;
    this.metaData = null;
    this.debugUrl = null;
    this.driver = null;
    this.header = 0;
    this.footer = 0;
    this.statusBarHeight = 0;
    this.pageXShiftFactor = 0;
    this.pageYShiftFactor = 0;
    this.currentTag = null;
    this.removeElementShiftFactor = 50000;
    this.initialScrollLocation = null;
  }

  addDefaultOptions() {
    this.options.freezeAnimation = this.options.freezeAnimatedImage || this.options.freezeAnimation || false;
  }

  async createDriver() {
    this.driver = new Driver(this.sessionId, this.commandExecutorUrl, this.capabilities);
    log.debug(`Passed capabilities -> ${JSON.stringify(this.capabilities)}`);
    const caps = await this.driver.getCapabilites();
    log.debug(`Fetched capabilities -> ${JSON.stringify(caps)}`);
    this.metaData = MetaDataResolver.resolve(this.driver, caps, this.capabilities);
  }

  static supports(_commandExecutorUrl) {
    return true;
  }

  addClientInfo(info) {
    for (let i of [].concat(info)) {
      if (i) this.clientInfoDetails.add(i);
    }
  }

  addEnvironmentInfo(info) {
    for (let i of [].concat(info)) {
      if (i) this.environmentInfoDetails.add(i);
    }
  }

  isIOS() {
    return this.currentTag?.osName === 'iOS';
  }

  async getScrollDetails() {
    return await this.driver.executeScript({ script: 'return [parseInt(window.scrollX), parseInt(window.scrollY)];', args: [] });
  }

  async getInitialScrollLocation() {
    if (this.initialScrollLocation) {
      return this.initialScrollLocation;
    }
    this.initialScrollLocation = await this.getScrollDetails();
    return this.initialScrollLocation;
  }

  async scrollToPosition(x, y) {
    await this.driver.executeScript({ script: `window.scrollTo(${x}, ${y})`, args: [] });
  }

  async browserstackExecutor(action, args) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    let options = args ? { action, arguments: args } : { action };
    let res = await this.driver.executeScript({ script: `browserstack_executor: ${JSON.stringify(options)}`, args: [] });
    return res;
  }

  async percyScreenshotBegin(name) {
    return await TimeIt.run('percyScreenshotBegin', async () => {
      try {
        let result = await this.browserstackExecutor('percyScreenshot', {
          name,
          percyBuildId: this.buildInfo.id,
          percyBuildUrl: this.buildInfo.url,
          state: 'begin'
        });
        // Selenium Hub, set status error Code to 13 if an error is thrown
        // Handling error with Selenium dialect is != W3C
        if (result?.status === 13) { throw new Error(result?.value || 'Got invalid error response'); }
        this._markedPercy = result.success;
        return result;
      } catch (e) {
        log.debug(`[${name}] : Could not mark Automate session as percy`);
        log.error(`[${name}] : error: ${e.toString()}`);
        /**
         * - Handling Error when dialect is W3C
         * ERROR response format from SeleniumHUB `{
         * sessionId: ...,
         * status: 13,
         * value: { error: '', message: ''}
         * }
         */
        const errResponse =
          (e?.response?.body && JSON.parse(e?.response?.body)?.value) || {};
        const errMessage =
          errResponse?.message ||
          errResponse?.error ||
          e?.message ||
          e?.error ||
          e?.value ||
          e.toString();
        throw new Error(errMessage);
      }
    });
  }

  async percyScreenshotEnd(name, error) {
    return await TimeIt.run('percyScreenshotEnd', async () => {
      try {
        await this.browserstackExecutor('percyScreenshot', {
          name,
          percyScreenshotUrl: this.buildInfo?.url,
          status: error ? 'failure' : 'success',
          statusMessage: error ? `${error}` : '',
          state: 'end',
          sync: this.options?.sync
        });
      } catch (e) {
        log.debug(`[${name}] : Could not execute percyScreenshot command for Automate`);
        log.error(e);
      }
    });
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

    const tiles = await this.getTiles(fullscreen);
    log.debug(`[${name}] : Tiles ${JSON.stringify(tiles)}`);

    this.currentTag = tag;
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
      regions: this.options.regions || null,
      algorithm: this.options.algorithm || null,
      algorithmConfiguration: this.options.algorithmConfiguration || null,
      environmentInfo: this.getUserAgentString(this.environmentInfoDetails),
      clientInfo: this.getUserAgentString(this.clientInfoDetails),
      domInfoSha: tiles.domInfoSha,
      metadata: tiles.metadata || null
    };
  }

  getUserAgentString(data) {
    let result = '';
    if (data instanceof Set) {
      result = [...data].join('; ');
    } else if (typeof data === 'string') {
      result = data;
    }
    return result;
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

  async getTiles(fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    const base64content = await this.driver.takeScreenshot();
    log.debug('Tiles captured successfully');
    return {
      tiles: [
        new Tile({
          content: base64content,
          statusBarHeight: 0,
          navBarHeight: 0,
          headerHeight: this.header,
          footerHeight: this.footer,
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

  // TODO: Add Debugging Url for non-automate
  async setDebugUrl() {
    this.debugUrl = 'https://localhost/v1';
  }

  async doTransformations() {
    const hideScrollbarStyle = `
    /* Hide scrollbar for Chrome, Safari and Opera */
    ::-webkit-scrollbar {
      display: none !important;
    }

    /* Hide scrollbar for IE, Edge and Firefox */
    body, html {
      -ms-overflow-style: none !important;  /* IE and Edge */
      scrollbar-width: none !important;  /* Firefox */
    }`.replace(/\n/g, '');
    const jsScript = `
    const e = document.createElement('style');
    e.setAttribute('class', 'poa-injected');
    e.innerHTML = '${hideScrollbarStyle}'
    document.head.appendChild(e);`;

    await this.driver.executeScript({ script: jsScript, args: [] });
    if (this.options?.fullPage || this.isIOS()) {
      await this.getInitialScrollLocation();
    }
  }

  async undoTransformations(data) {
    const jsScript = `
      const n = document.querySelectorAll('${data}');
      n.forEach((e) => {e.remove()});`;

    await this.driver.executeScript({ script: jsScript, args: [] });
  }

  async findRegions(xpaths, selectors, elements, customLocations) {
    let isRegionPassed = [xpaths, selectors, elements, customLocations].some(regions => regions.length > 0);
    if (isRegionPassed) {
      await this.doTransformations();
      const xpathRegions = await this.getSeleniumRegionsBy('xpath', xpaths);
      const selectorRegions = await this.getSeleniumRegionsBy('css selector', selectors);
      const elementRegions = await this.getSeleniumRegionsByElement(elements);
      const customRegions = await this.getSeleniumRegionsByLocation(customLocations);
      await this.undoTransformations('.poa-injected');

      return [
        ...xpathRegions,
        ...selectorRegions,
        ...elementRegions,
        ...customRegions
      ];
    } else {
      return [];
    }
  }

  async getRegionObjectFromBoundingBox(selector, element) {
    const scaleFactor = await this.metaData.devicePixelRatio();
    let scrollX = 0, scrollY = 0;
    if (this.options?.fullPage) {
      scrollX = this.initialScrollLocation.value[0];
      scrollY = this.initialScrollLocation.value[1];
    }

    let headerAdjustment = 0;
    if (this.isIOS()) {
      headerAdjustment = this.statusBarHeight;
    }
    const coOrdinates = {
      top: Math.floor((element.y + scrollY) * scaleFactor) + Math.floor(headerAdjustment),
      bottom: Math.ceil((element.y + element.height + scrollY) * scaleFactor) + Math.ceil(headerAdjustment),
      left: Math.floor((element.x + scrollX) * scaleFactor),
      right: Math.ceil((element.x + element.width + scrollX) * scaleFactor)
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

  async updatePageShiftFactor(location, scaleFactor, scrollFactors) {
    if (this.isIOS() || (this.currentTag.osName === 'OS X' && parseInt(this.currentTag.browserVersion) > 13 && this.currentTag.browserName.toLowerCase() === 'safari')) {
      this.pageYShiftFactor = this.statusBarHeight;
    } else {
      this.pageYShiftFactor = this.statusBarHeight - (scrollFactors.value[1] * scaleFactor);
    }
    this.pageXShiftFactor = this.isIOS() ? 0 : (-(scrollFactors.value[0] * scaleFactor));
    if (this.isIOS() && !this.options?.fullPage) {
      if (scrollFactors.value[0] !== this.initialScrollLocation.value[0] || scrollFactors.value[1] !== this.initialScrollLocation.value[1]) {
        this.pageXShiftFactor = (-1 * this.removeElementShiftFactor);
        this.pageYShiftFactor = (-1 * this.removeElementShiftFactor);
      } else if (location.y === 0) {
        this.pageYShiftFactor += (-(scrollFactors.value[1] * scaleFactor));
      }
    }
  }

  async getRegionObject(selector, elementId) {
    const scaleFactor = await this.metaData.devicePixelRatio();
    const rect = await this.driver.rect(elementId);
    const location = { x: rect.x, y: rect.y };
    const size = { height: rect.height, width: rect.width };
    let scrollX = 0, scrollY = 0;
    const scrollFactors = await this.getScrollDetails();
    if (this.options?.fullPage) {
      scrollX = scrollFactors.value[0];
      scrollY = scrollFactors.value[1];
    }

    // Update pageShiftFactor Element is not visible in viewport
    // In case of iOS if the element is not visible in viewport it gives 0 for x-y coordinate.
    // In case of iOS if the element is partially visible it gives negative x-y coordinate.
    // Subtracting ScrollY/ScrollX ensures if the element is visible in viewport or not.
    await this.updatePageShiftFactor(location, scaleFactor, scrollFactors);
    const coOrdinates = {
      top: Math.floor((location.y + scrollY) * scaleFactor) + Math.floor(this.pageYShiftFactor),
      bottom: Math.ceil((location.y + size.height + scrollY) * scaleFactor) + Math.ceil(this.pageYShiftFactor),
      left: Math.floor((location.x + scrollX) * scaleFactor) + Math.floor(this.pageXShiftFactor),
      right: Math.ceil((location.x + size.width + scrollX) * scaleFactor) + Math.ceil(this.pageXShiftFactor)
    };

    const jsonObject = {
      selector,
      coOrdinates
    };

    return jsonObject;
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

    if (this.isIOS()) {
      await this.scrollToPosition(this.initialScrollLocation.value[0], this.initialScrollLocation.value[1]);
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

  async getTag(tagData) {
    if (!this.automateResults) throw new Error('Comparison tag details not available');
    const automateCaps = this.automateResults.capabilities;
    const normalizeTags = new NormalizeData();

    let deviceName = this.automateResults.deviceName;
    const osName = normalizeTags.osRollUp(automateCaps.os);
    const osVersion = automateCaps.os_version?.split('.')[0];
    const browserName = normalizeTags.browserRollUp(automateCaps.browserName, tagData.device);
    const browserVersion = normalizeTags.browserVersionOrDeviceNameRollup(automateCaps.browserVersion, deviceName, tagData.device);

    if (!tagData.device) {
      deviceName = `${osName}_${osVersion}_${browserName}_${browserVersion}`;
    }

    let { width, height } = { width: tagData.width, height: tagData.height };
    const resolution = tagData.resolution;
    const orientation = tagData.orientation || automateCaps.deviceOrientation || 'landscape';

    return {
      name: deviceName,
      osName,
      osVersion,
      width,
      height,
      orientation,
      browserName,
      browserVersion,
      resolution
    };
  }
}
