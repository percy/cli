const { GenericProvider } = require('./genericProvider');
const { TimeIt } = require('../util/timing');
const { Tile } = require('../util/tile');
const log = require('../util/log');

class AppAutomateProvider extends GenericProvider {
  constructor(driver) {
    super(driver);
    this._markedPercy = false;
  }

  static supports(driver) {
    return driver.remoteHostname.includes(process.env.AA_DOMAIN || 'browserstack');
  }

  async screenshot(name, {
    fullscreen,
    deviceName,
    orientation,
    statusBarHeight,
    navigationBarHeight,
    fullPage,
    screenLengths,
    ignoreRegionXpaths,
    ignoreRegionAccessibilityIds,
    ignoreRegionAppiumElements,
    customIgnoreRegions,
    scrollableXpath,
    scrollableId
  } = {}) {
    let response = null;
    let error;
    try {
      let result = await this.percyScreenshotBegin(name);
      this.setDebugUrl(result);
      response = await super.screenshot(name, {
        fullscreen,
        deviceName: deviceName || result?.deviceName,
        osVersion: result?.osVersion?.split('.')[0],
        orientation,
        statusBarHeight,
        navigationBarHeight,
        fullPage,
        screenLengths,
        ignoreRegionXpaths,
        ignoreRegionAccessibilityIds,
        ignoreRegionAppiumElements,
        customIgnoreRegions,
        scrollableXpath,
        scrollableId
      });
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
        log.debug(`[${name}] Could not mark App Automate session as percy`);
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

  // Override this for AA specific optimizations
  async getTiles(fullscreen, fullPage, screenLengths, scrollableXpath, scrollableId) {
    // Temporarily restrict AA optimizations only for full page
    if (fullPage !== true) {
      return await super.getTiles(fullscreen, fullPage, screenLengths);
    }

    // Take screenshots via browserstack executor
    const response = await TimeIt.run('percyScreenshot:screenshot', async () => {
      return await this.browserstackExecutor('percyScreenshot', {
        state: 'screenshot',
        percyBuildId: process.env.PERCY_BUILD_ID,
        screenshotType: 'fullpage',
        scaleFactor: await this.metadata.scaleFactor(),
        options: {
          numOfTiles: screenLengths || 4,
          deviceHeight: (await this.metadata.screenSize()).height,
          scollableXpath: scrollableXpath || null,
          scrollableId: scrollableId || null
        }
      });
    });

    if (!response.success) {
      throw new Error('Failed to get screenshots from App Automate.' +
      ' Check dashboard for error.');
    }

    const tiles = [];
    const statBarHeight = await this.metadata.statusBarHeight();
    const navBarHeight = await this.metadata.navigationBarHeight();

    JSON.parse(response.result).forEach(tileData => {
      tiles.push(new Tile({
        statBarHeight,
        navBarHeight,
        fullscreen,
        headerHeight: tileData.header_height,
        footerHeight: tileData.footer_height,
        sha: tileData.sha.split('-')[0] // drop build id
      }));
    });

    return tiles;
  }

  async browserstackExecutor(action, args) {
    let options = args ? { action, arguments: args } : { action };
    return JSON.parse(await this.driver.execute(`browserstack_executor: ${JSON.stringify(options)}`));
  }

  setDebugUrl(result) {
    if (!result) return null;

    const buildHash = result.buildHash;
    const sessionHash = result.sessionHash;
    this.debugUrl = `https://app-automate.browserstack.com/dashboard/v2/builds/${buildHash}/sessions/${sessionHash}`;
  }
}

module.exports = {
  AppAutomateProvider
};
