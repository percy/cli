import DriverWrapper from './driverWrapper.js';

export default class Driver {
  constructor(sessionId, executorUrl) {
    this.sessionId = sessionId;
    this.executorUrl = executorUrl;
    this.helper = new DriverWrapper(this.sessionId, this.executorUrl);
  }
}
