export default class CommonDesktopMetaDataResolver {
  constructor(driver, opts = {}) {
    this.driver = driver;
    this.capabilities = opts;
  }

  browserName() {
    return this.capabilities.browserName.toLowerCase();
  }

  osName() {
    let osName = this.capabilities.osVersion;
    if (osName) return osName.toLowerCase();

    osName = this.capabilities.platform;
    return osName;
  }

  // desktop will show this as browser version
  osVersion() {
    return this.capabilities.version.split('.')[0];
  }

  deviceName() {
    return this.browserName() + '_' + this.osVersion() + '_' + this.osName();
  }

  orientation() {
    return 'portrait';
  }

  async windowSize() {
    const dpr = await this.devicePixelRatio();
    const data = await this.driver.getWindowSize();
    const width = parseInt(data.value.width * dpr), height = parseInt(data.value.height * dpr);
    return { width, height };
  }

  async devicePixelRatio() {
    const devicePixelRatio = await this.driver.executeScript({ script: 'return window.devicePixelRatio;', args: [] });
    return devicePixelRatio.value;
  }
}
