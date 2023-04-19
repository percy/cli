export default class CommonMobileMetaDataResolver {
  constructor(driver, opts = {}) {
    this.driver = driver;
    this.capabilities = opts;
  }

  browserName() {
    return this.capabilities.browserName.toLowerCase();
  }

  osName() {
    let osName = this.capabilities.os.toLowerCase();
    if (osName === 'mac' && this.browserName() === 'iphone') {
      osName = 'ios';
    }
    return osName;
  }

  osVersion() {
    return this.capabilities.osVersion.split('.')[0];
  }

  deviceName() {
    return this.capabilities.deviceName.split('-')[0];
  }

  orientation() {
    return this.capabilities.orientation;
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
