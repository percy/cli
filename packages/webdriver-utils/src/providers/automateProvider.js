import utils from '@percy/sdk-utils';
import GenericProvider from './genericProvider.js';
import Cache from '../util/cache.js';
import Tile from '../util/tile.js';
import NormalizeData from '../metadata/normalizeData.js';
import TimeIt from '../util/timing.js';
import MetaDataResolver from '../metadata/metaDataResolver.js';
import Driver from '../driver.js';

const log = utils.logger('webdriver-utils:automateProvider');

export default class AutomateProvider extends GenericProvider {
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
    super(
     {
      sessionId,
      commandExecutorUrl,
      capabilities,
      sessionCapabilites,
      clientInfo,
      environmentInfo,
      options,
      buildInfo
     }
    );
  }

  static supports(commandExecutorUrl) {
    return true || commandExecutorUrl.includes(process.env.AA_DOMAIN || 'browserstack');
  }

  async createDriver() {
    this.driver = new Driver(this.sessionId, this.commandExecutorUrl, this.capabilities);
    log.debug(`Passed capabilities -> ${JSON.stringify(this.capabilities)}`);
    const caps = await this.driver.getCapabilites();
    log.debug(`Fetched capabilities -> ${JSON.stringify(caps)}`);
    this.metaData = await MetaDataResolver.resolve(this.driver, caps, this.capabilities);
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
    let response = null;
    let error;
    log.debug(`[${name}] : Preparing to capture screenshots on automate ...`);
    try {
      log.debug(`[${name}] : Marking automate session as percy ...`);
      const result = await this.percyScreenshotBegin(name);
      this.automateResults = JSON.parse(result.value);
      log.debug(`[${name}] : Fetching the debug url ...`);
      this.setDebugUrl();
      response = await super.screenshot(name, {
        ignoreRegionXpaths,
        ignoreRegionSelectors,
        ignoreRegionElements,
        customIgnoreRegions,
        considerRegionXpaths,
        considerRegionSelectors,
        considerRegionElements,
        customConsiderRegions
      });
    } catch (e) {
      error = e;
      throw e;
    } finally {
      await this.percyScreenshotEnd(name, error);
    }
    return response;
  }

  async getTiles(fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    log.debug('Starting actual screenshotting phase');
    const dpr = await this.metaData.devicePixelRatio();
    const screenshotType = 'fullpage';
    const response = await TimeIt.run('percyScreenshot:screenshot', async () => {
      return await this.browserstackExecutor('percyScreenshot', {
        state: 'screenshot',
        percyBuildId: this.buildInfo.id,
        screenshotType: screenshotType,
        scaleFactor: dpr,
        projectId: 'percy-dev',
        options: this.options
      });
    });

    const responseValue = JSON.parse(response.value);
    if (!responseValue.success) {
      throw new Error('Failed to get screenshots from Automate.' +
      ' Check dashboard for error.');
    }

    const tiles = [];
    const tileResponse = JSON.parse(responseValue.result);
    log.debug('Tiles captured successfully');
    for (let tileData of tileResponse.tiles) {
      tiles.push(new Tile({
        statusBarHeight: tileData.status_bar || 0,
        navBarHeight: tileData.nav_bar || 0,
        headerHeight: tileData.header_height || 0,
        footerHeight: tileData.footer_height || 0,
        fullscreen,
        sha: tileData.sha.split('-')[0] // drop build id
      }));
    }
    const metadata = {
      screenshotType: screenshotType
    };
    return { tiles: tiles, domInfoSha: tileResponse.dom_sha, metadata: metadata };
  }

  async setDebugUrl() {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    this.debugUrl = await Cache.withCache(Cache.bstackSessionDetails, this.driver.sessionId,
      async () => {
        return `https://automate.browserstack.com/builds/${this.automateResults.buildHash}/sessions/${this.automateResults.sessionHash}`;
      });
  }

  async getTag() {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    if (!this.automateResults) throw new Error('Comparison tag details not available');

    const automateCaps = this.automateResults.capabilities;
    const normalizeTags = new NormalizeData();

    let deviceName = this.automateResults.deviceName;
    const osName = normalizeTags.osRollUp(automateCaps.os);
    const osVersion = automateCaps.os_version?.split('.')[0];
    const browserName = normalizeTags.browserRollUp(automateCaps.browserName, this.metaData.device());
    const browserVersion = normalizeTags.browserVersionOrDeviceNameRollup(automateCaps.browserVersion, deviceName, this.metaData.device());

    if (!this.metaData.device()) {
      deviceName = `${osName}_${osVersion}_${browserName}_${browserVersion}`;
    }

    let { width, height } = await this.metaData.windowSize();
    const resolution = await this.metaData.screenResolution();
    const orientation = (this.metaData.orientation() || automateCaps.deviceOrientation)?.toLowerCase();

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
