
import logger from '@percy/logger';

export default class TimeIt {
  log = logger('timer');
  // returns a singleton instance
  constructor() {
    let { instance = this } = this.constructor;
    this.constructor.instance = instance;
    return instance;
  }

  async measure(name, identifier, callback) {
    const startTime = Date.now();
    try {
      return await callback();
    } finally {
      const duration = Date.now() - startTime;
      this.log.debug(`${name} - ${identifier} - ${duration / 1000}s`);
    }
  }
}
