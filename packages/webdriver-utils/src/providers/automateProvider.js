import utils from '@percy/sdk-utils';
import GenericProvider from './genericProvider.js';
import Cache from '../util/cache.js';
import Tile from '../util/tile.js';

const log = utils.logger('webdriver-utils:automateProvider');
const { TimeIt } = utils;

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
      sessionId,
      commandExecutorUrl,
      capabilities,
      sessionCapabilites,
      clientInfo,
      environmentInfo,
      options,
      buildInfo
    );
    this._markedPercy = false;
  }

  static supports(commandExecutorUrl) {
    return commandExecutorUrl.includes(process.env.AA_DOMAIN || 'browserstack');
  }

  async screenshot(name, {
    ignoreRegionXpaths = [],
    ignoreRegionSelectors = [],
    ignoreRegionElements = [],
    customIgnoreRegions = []
  }) {
    let response = null;
    let error;
    log.info('Preparing to capture screenshots on automate ...');
    try {
      log.debug('Marking automate session as percy ...');
      let result = await this.percyScreenshotBegin(name);
      log.debug('Fetching the debug url ...');
      this.setDebugUrl(result);
      response = await super.screenshot(name, { ignoreRegionXpaths, ignoreRegionSelectors, ignoreRegionElements, customIgnoreRegions });
    } catch (e) {
      error = e;
      throw e;
    } finally {
      await this.percyScreenshotEnd(name, response?.body?.link, `${error}`);
    }
    return response;
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
        this._markedPercy = result.success;
        return result;
      } catch (e) {
        log.debug(`[${name}] Could not mark Automate session as percy`);
        log.error(`[${name}] error: ${e.toString()}`);
        return null;
      }
    });
  }

  async percyScreenshotEnd(name, percyScreenshotUrl, statusMessage = null) {
    return await TimeIt.run('percyScreenshotEnd', async () => {
      try {
        await this.browserstackExecutor('percyScreenshot', {
          name,
          percyScreenshotUrl,
          status: percyScreenshotUrl ? 'success' : 'failure',
          statusMessage,
          state: 'end'
        });
      } catch (e) {
        log.debug(`[${name}] Could not execute percyScreenshot command for Automate`);
        log.error(e);
      }
    });
  }

  async getTiles(headerHeight, footerHeight, fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    log.info('Starting actual screenshotting phase');

    const response = await TimeIt.run('percyScreenshot:screenshot', async () => {
      return await this.browserstackExecutor('percyScreenshot', {
        state: 'screenshot',
        percyBuildId: this.buildInfo.id,
        screenshotType: 'singlepage',
        scaleFactor: await this.driver.executeScript({ script: 'return window.devicePixelRatio;', args: [] }),
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

    for (let tileData of tileResponse.sha) {
      tiles.push(new Tile({
        statusBarHeight: 0,
        navBarHeight: 0,
        headerHeight,
        footerHeight,
        fullscreen,
        sha: tileData.split('-')[0] // drop build id
      }));
    }
    return { tiles: tiles, domInfoSha: tileResponse.dom_sha };
  }

  async browserstackExecutor(action, args) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    let options = args ? { action, arguments: args } : { action };
    let res = await this.driver.executeScript({ script: `browserstack_executor: ${JSON.stringify(options)}`, args: [] });
    return res;
  }

  async setDebugUrl() {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');
    this.debugUrl = await Cache.withCache(Cache.bstackSessionDetails, this.driver.sessionId,
      async () => {
        const sessionDetails = await this.browserstackExecutor('getSessionDetails');
        return JSON.parse(sessionDetails.value).browser_url;
      });
  }
}
