export default class CommonDesktopMetaDataResolver {
  constructor(driver, opts = {}) {
    this.driver = driver;
    this.capabilities = opts;
  }

  async browserName() {
    return await this.capabilities.browserName.toLowerCase();
  }

  async osName() {
    let osName = await this.capabilities.osVersion;
    if (osName) return osName.toLowerCase();

    osName = await this.capabilities.platform;
    return osName;
  }

  // desktop will show this as browser version
  async osVersion() {
    return await this.capabilities.version.split('.')[0];
  }

  async deviceName() {
    return await this.browserName() + '_' + await this.osVersion() + '_' + await this.osName();
  }

  async orientation() {
    return 'portrait';
  }

  async windowSize() {
    const dpr = await this.devicePixelRatio();
    const data = await this.driver.helper.getWindowSize();
    const width = parseInt(data.value.width * dpr), height = parseInt(data.value.height * dpr);
    return { width, height };
  }

  async devicePixelRatio() {
    const devicePixelRatio = await this.driver.helper.executeScript({ script: 'return window.devicePixelRatio;', args: [] });
    return devicePixelRatio.value;
  }
}
