export default class MetaData {
  constructor(capabilites) {
    this.capabilites = capabilites;
  }

  async osName() {
    return await this.capabilites.platformName;
  }

  async osVersion() {
    return (await this.capabilites.osVersion || await this.capabilites.platformVersion)?.split('.')[0];
  }

  async orientation() {
    return 'portrait';
    if (await this.capabilites.orientation) {
      return this.capabilites.orientation;
    }
    const deviceOrientation = (await this.capabilites.deviceOrientation)?.toLowercase();
    if (deviceOrientation) return deviceOrientation;
    return 'portrait';
  }

  async screenSize() {
    const deviceScreenSize = await this.capabilites.deviceScreenSize;
    if (deviceScreenSize) {
      const [width, height] = deviceScreenSize.split('x').map(i => parseInt(i, 10));
      return { width, height };
    } else {
      const width = 1080;
      const height = 2200;
      return { width, height };
    }
  }

  async deviceName() {
    return await this.capabilites.deviceName || await this.capabilites.desired.device;
  }

  async scaleFactor() {
    return 1;
  }
}
