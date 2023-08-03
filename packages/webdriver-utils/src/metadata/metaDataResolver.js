import DesktopMetaData from './desktopMetaData.js';
import MobileMetaData from './mobileMetaData.js';

export default class MetaDataResolver {
  static resolve(driver, capabilities, opts) {
    if (!driver) throw new Error('Please pass a Driver object');

    const platform = opts.platformName || opts.platform;
    if (['ios', 'android'].includes(platform.toLowerCase()) ||
      ['ios', 'android'].includes(capabilities?.platformName?.toLowerCase()) ||
      ['ipad', 'iphone'].includes(capabilities?.device?.toString()?.toLowerCase())) {
      return new MobileMetaData(driver, capabilities);
    } else {
      return new DesktopMetaData(driver, capabilities);
    }
  }
}
