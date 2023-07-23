export default class NormalizeData {
  osRollUp(os) {
    if (os.toLowerCase().startsWith('win')) {
      return 'Windows';
    } else if (os.toLowerCase().startsWith('mac')) {
      return 'OS X';
    } else if (os.toLowerCase().includes('iphone') || os.toLowerCase().startsWith('ios')) {
      return 'iOS';
    } else if (os.toLowerCase().startsWith('android')) {
      return 'Android';
    }
    return os;
  }

  browserRollUp(browserName, device) {
    if (device) {
      if (browserName?.toLowerCase().includes('chrome')) {
        return 'chrome';
      } else if ((browserName?.toLowerCase().includes('iphone') ||
          browserName?.toLowerCase().includes('ipad'))) {
        return 'safari';
      }
    }
    return browserName;
  }

  browserVersionRollUp(browserVersion, deviceName, device) {
    if (device) {
      // return `${this.osRollUp(os)} ${osVersion?.split('.')[0]}`;
      return deviceName;
    }
    return browserVersion?.split('.')[0];
  }
}
