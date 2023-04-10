import MobileResolver from './mobileResolver.js';
import { DesktopResolver } from './desktopResolver.js';

export default class MetaDataResolver {
  async resolve(capabilities) {
    const platform = capabilities.platformName.toLowerCase();
    if (['ios', 'android'].includes(platform)) {
      return await MobileResolver.resolve(capabilities);
    } else {
      return new DesktopResolver(capabilities);
    }
  }
}
