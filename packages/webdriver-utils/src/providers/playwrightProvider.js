import utils from '@percy/sdk-utils';
import TimeIt from '../util/timing.js';
import NormalizeData from '../metadata/normalizeData.js';
import Tile from '../util/tile.js';
import GenericProvider from './genericProvider.js';
import PlaywrightDriver from '../playwrightDriver.js';

const log = utils.logger('webdriver-utils:genericProvider');

export default class PlaywrightProvider extends GenericProvider {
  constructor(
    sessionId,
    frameGuid,
    pageGuid,
    clientInfo,
    environmentInfo,
    options,
    buildInfo
  ) {
    super(
      {
        sessionId,
        frameGuid,
        pageGuid,
        clientInfo,
        environmentInfo,
        options,
        buildInfo
      }
    );
  }

  async createDriver() {
    this.driver = new PlaywrightDriver(this.sessionId);
  }

  async setDebugUrl() {
    this.debugUrl = `https://automate.browserstack.com/builds/${this.automateResults.buildHash}/sessions/${this.automateResults.sessionHash}`;
  }

  async screenshot(name, options) {
    let response = null;
    let error;
    log.debug(`[${name}] : Preparing to capture screenshots on playwrght with automate ...`);
    try {
      log.debug(`[${name}] : Marking automate session as percy ...`);
      const result = await this.percyScreenshotBegin(name);
      this.automateResults = JSON.parse(result.value);
      log.debug(`[${name}] : Begin response ${this.automateResults}`);
      log.debug(`[${name}] : Fetching the debug url ...`);
      this.setDebugUrl();
      const tiles = await this.getTiles();
      log.debug(`[${name}] : Tiles ${JSON.stringify(tiles)}`);
      log.debug('Fetching comparisong tag ...');
      const tag = await this.getTag(tiles.tagData);
      log.debug(`[${name}] : Tag ${JSON.stringify(tag)}`);
      response = {
        name,
        tag,
        tiles: tiles.tiles,
        // TODO: Fetch this one for bs automate, check appium sdk
        externalDebugUrl: this.debugUrl,
        ignoredElementsData: {
          ignoreElementsData: tiles.ignoreRegionsData
        },
        consideredElementsData: {
          considerElementsData: tiles.considerRegionsData
        },
        regions: options.regions || null,
        algorithm: options.algorithm || null,
        algorithmConfiguration: options.algorithmConfiguration || null,
        environmentInfo: this.environmentInfo,
        clientInfo: this.clientInfo,
        domInfoSha: tiles.domInfoSha,
        metadata: tiles.metadata || null
      };
    } catch (e) {
      console.trace(e);
      error = e;
      throw e;
    } finally {
      await this.percyScreenshotEnd(name, error);
    }
    return response;
  }

  async getTiles(fullscreen = true) {
    log.debug(`Starting actual screenshotting phase with Page GUID: ${this.pageGuid}, Frame GUID: ${this.frameGuid}`);
    const screenshotType = this.options?.fullPage ? 'fullpage' : 'singlepage';
    const response = await TimeIt.run('percyScreenshot:screenshot', async () => {
      return await this.browserstackExecutor('percyScreenshot', {
        state: 'screenshot',
        percyBuildId: this.buildInfo.id,
        screenshotType: screenshotType,
        scaleFactor: 1,
        options: this.options,
        frameworkData: {
          frameGuid: this.frameGuid,
          pageGuid: this.pageGuid
        },
        framework: 'playwright'
      });
    });
    log.debug(`Response ${JSON.stringify(response)}`);
    const responseValue = JSON.parse(response.value);
    if (!responseValue.success) {
      throw new Error('Failed to get screenshots from Automate.' +
      ' Check dashboard for error.');
    }

    const tiles = [];
    log.debug('Capturing tiles');
    const tileResponse = JSON.parse(responseValue.result);
    log.debug(`Tiles captured successfully ${JSON.stringify(tileResponse)}`);
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
    const tagData = {
      width: tileResponse.comparison_tag_data.width,
      height: tileResponse.comparison_tag_data.height,
      resolution: tileResponse.comparison_tag_data.resolution
    };

    const ignoreRegionsData = tileResponse.ignore_regions_data || [];
    const considerRegionsData = tileResponse.consider_regions_data || [];
    const metadata = {
      screenshotType: screenshotType
    };
    return {
      tiles: tiles,
      domInfoSha: tileResponse.dom_sha,
      metadata: metadata,
      tagData: tagData,
      ignoreRegionsData: ignoreRegionsData,
      considerRegionsData: considerRegionsData
    };
  }

  async getTag(tagData) {
    if (!this.automateResults) throw new Error('Comparison tag details not available');
    const mobileOS = ['ANDROID'];
    const normalizeTags = new NormalizeData();
    const automateCaps = this.automateResults.capabilities;
    const osName = normalizeTags.osRollUp(automateCaps.os);
    const device = mobileOS.includes(osName.toUpperCase());
    tagData.device = device;
    return await super.getTag(tagData);
  }
}
