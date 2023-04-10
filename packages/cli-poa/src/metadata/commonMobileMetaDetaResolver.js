export default class CommonMobileMetaDataResolver {
  constructor(driver, opts = {}) {
    this.driver = driver;
    this.capabilities = opts;
  }

  async browserName() {
    return await this.capabilities.browserName.toLowerCase();
  }

  async osName() {
    let osName = await this.capabilities.os.toLowerCase();
    if (osName === 'mac' && await this.browserName() === 'iphone') {
      osName = 'ios';
    }
    return osName;
  }

  async osVersion() {
    return await this.capabilities.osVersion.split('.')[0];
  }

  async deviceName() {
    return await this.capabilities.deviceName.split('-')[0];
  }

  async orientation() {
    return await this.capabilities.orientation;
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
