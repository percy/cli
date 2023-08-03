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

  // Responses for browser version differ for devices and desktops from capabilities
  // Differenences in selenium and appium responses causes inconsistency
  // So to tackle for devices on UI we will show device names else browser versions
  browserVersionOrDeviceNameRollup(browserVersion, deviceName, device) {
    if (device) {
      return deviceName;
    }
    return browserVersion?.split('.')[0];
  }
}
