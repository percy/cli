import MetaData from './metadata.js';

export default class MobileResolver {
  static async resolve(capabilites) {
    return new MetaData(capabilites);
  }
}
