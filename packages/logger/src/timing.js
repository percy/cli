
export default class TimeIt {
  // returns a singleton instance
  constructor(log) {
    let { instance = this } = this.constructor;
    instance.log = log;
    this.constructor.instance = instance;
    return instance;
  }

  async measure(name, identifier, meta, callback) {
    const startTime = Date.now();
    try {
      return await callback();
    } finally {
      const duration = Date.now() - startTime;
      this.log.debug(`${name} - ${identifier} - ${duration / 1000}s`, meta);
    }
  }
}
