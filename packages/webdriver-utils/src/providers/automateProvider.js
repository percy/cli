import utils from '@percy/sdk-utils';
import GenericProvider from './genericProvider.js';
import Cache from '../util/cache.js';
import Tile from '../util/tile.js';
import TimeIt from '../util/timing.js';

const log = utils.logger('webdriver-utils:automateProvider');
export default class AutomateProvider extends GenericProvider {
  constructor(
    sessionId,
    commandExecutorUrl,
    capabilities,
    sessionCapabilites,
    clientInfo,
    environmentInfo,
    options
  ) {
    super(
      sessionId,
      commandExecutorUrl,
      capabilities,
      sessionCapabilites,
      clientInfo,
      environmentInfo,
      options
    );
    this._markedPercy = false;
  }

  static supports(commandExecutorUrl) {
    return commandExecutorUrl.includes(process.env.AA_DOMAIN || 'browserstack');
  }

  async screenshot(name) {
    let response = null;
    let error;
    try {
      let result = await this.percyScreenshotBegin(name);
      this.setDebugUrl(result);
      response = await super.screenshot(name);
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
          percyBuildId: process.env.PERCY_BUILD_ID,
          percyBuildUrl: process.env.PERCY_BUILD_URL,
          state: 'begin'
        });
        this._markedPercy = result.success;
        return result;
      } catch (e) {
        log.debug(`[${name}] Could not mark Automate session as percy`);
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
        log.debug(`[${name}] Could not mark App Automate session as percy`);
      }
    });
  }

  async getTiles(fullscreen) {
    if (!this.driver) throw new Error('Driver is null, please initialize driver with createDriver().');

    const response = await TimeIt.run('percyScreenshot:screenshot', async () => {
      return await this.browserstackExecutor('percyScreenshot', {
        state: 'screenshot',
        percyBuildId: process.env.PERCY_BUILD_ID,
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

    for (let tileData of tileResponse.sha) {
      tiles.push(new Tile({
        statusBarHeight: 0,
        navBarHeight: 0,
        headerHeight: 0,
        footerHeight: 0,
        fullscreen,
        sha: tileData.split('-')[0] // drop build id
        // dom-sha: tileData.dom_sha
      }));
    }
    return tiles;
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
