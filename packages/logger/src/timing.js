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
    let errorMsg;
    let errorStack;
    try {
      return await callback();
    } catch (e) {
      errorMsg = e.message;
      errorStack = e.stack;
      throw e;
    } finally {
      const duration = Date.now() - startTime;
      this.log.debug(
        `${name} - ${identifier} - ${duration / 1000}s`,
        {
          durationMs: duration,
          errorMsg,
          errorStack,
          ...meta
        }
      );
    }
  }
}
