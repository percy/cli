import helpers from './helpers';
import logger from '../src';

// very shallow mock websocket
class MockSocket {
  constructor(client) {
    this.client = client || new MockSocket(this);
    this.readyState = 0;
  }

  send(message) {
    this.client.onmessage?.({ data: message });
  }
}

describe('remote logging', () => {
  let log, socket;

  beforeEach(async () => {
    helpers.mock();
    log = logger('remote');
    socket = new MockSocket();
  });

  afterEach(() => {
    delete process.env.PERCY_LOGLEVEL;
    delete process.env.PERCY_DEBUG;
  });

  it('can connect to a remote logger', async () => {
    let connected = logger.remote(socket);
    await expectAsync(connected).toBePending();

    socket.readyState = 1;
    socket.onopen();

    await expectAsync(connected).toBeResolved();
  });

  it('logs a local debug error when unable to connect remotely', async () => {
    setTimeout(e => socket.onerror(e), 100, { error: 'Socket Error' });

    logger.loglevel('debug');
    await logger.remote(socket);

    expect(helpers.stderr).toEqual([
      '[percy:logger] Unable to connect to remote logger',
      '[percy:logger] Socket Error'
    ]);
  });

  it('logs a fallback debug message when an error is emitted without one', async () => {
    setTimeout(e => socket.onerror(e), 100, { type: 'error' });

    logger.loglevel('debug');
    await logger.remote(socket);

    expect(helpers.stderr).toEqual([
      '[percy:logger] Unable to connect to remote logger',
      '[percy:logger] Error: Socket connection failed'
    ]);
  });

  it('logs a local debug error when the connection times out', async () => {
    logger.loglevel('debug');
    await logger.remote(socket, 10);

    expect(helpers.stderr).toEqual([
      '[percy:logger] Unable to connect to remote logger',
      '[percy:logger] Error: Socket connection timed out'
    ]);
  });

  it('sends all previous logs when connected remotely', async () => {
    log.info('Remote connection test 1');
    log.info('Remote connection test 2', { foo: 'bar' });

    spyOn(socket, 'send');
    socket.readyState = 1;
    await logger.remote(socket);

    expect(socket.send).toHaveBeenCalled();
    expect(JSON.parse(socket.send.calls.first().args[0])).toEqual({
      logAll: [{
        level: 'info',
        debug: 'remote',
        message: 'Remote connection test 1',
        meta: { remote: true },
        timestamp: jasmine.any(Number)
      }, {
        level: 'info',
        debug: 'remote',
        message: 'Remote connection test 2',
        meta: { remote: true, foo: 'bar' },
        timestamp: jasmine.any(Number)
      }]
    });
  });

  it('sends logs remotely when connected', async () => {
    spyOn(socket, 'send');
    socket.readyState = 1;
    await logger.remote(socket);

    expect(socket.send).not.toHaveBeenCalled();

    log.info('Remote connection test');

    expect(socket.send).toHaveBeenCalled();
    expect(JSON.parse(socket.send.calls.first().args[0])).toEqual({
      log: ['remote', 'info', 'Remote connection test', { remote: true }]
    });
  });

  it('sends serialized error logs remotely when conected', async () => {
    spyOn(socket, 'send');
    socket.readyState = 1;
    await logger.remote(socket);

    expect(socket.send).not.toHaveBeenCalled();

    let error = new Error('Test');
    log.error(error);

    expect(socket.send).toHaveBeenCalled();
    expect(JSON.parse(socket.send.calls.first().args[0])).toEqual({
      log: ['remote', 'error', {
        message: 'Test',
        stack: error.stack
      }, { remote: true }]
    });
  });

  it('updates local env info when connected remotely', async () => {
    socket.readyState = 1;
    await logger.remote(socket);

    expect(process.env.PERCY_LOGLEVEL).toBeUndefined();
    expect(process.env.PERCY_DEBUG).toBeUndefined();

    socket.client.send('{}');

    expect(process.env.PERCY_LOGLEVEL).toBeUndefined();
    expect(process.env.PERCY_DEBUG).toBeUndefined();

    socket.client.send(JSON.stringify({
      env: {
        PERCY_LOGLEVEL: 'debug',
        PERCY_DEBUG: '*'
      }
    }));

    expect(process.env.PERCY_LOGLEVEL).toEqual('debug');
    expect(process.env.PERCY_DEBUG).toEqual('*');
  });

  it('can disconnect by running the returned function', async () => {
    spyOn(socket, 'send');
    socket.readyState = 1;
    let disconnect = await logger.remote(socket);

    log.info('Remote connection test 1');
    log.info('Remote connection test 2');

    expect(socket.send).toHaveBeenCalledTimes(2);

    disconnect();
    log.info('Remote connection test 3');

    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it('does not connect to more than one socket', async () => {
    let { instance } = helpers.constructor;
    let socket2 = new MockSocket();

    socket.readyState = 1;
    socket2.readyState = 1;

    expect(instance.socket).toBeUndefined();

    await logger.remote(socket);
    expect(instance.socket).toBe(socket);

    await logger.remote(socket2);
    expect(instance.socket).not.toBe(socket2);
    expect(instance.socket).toBe(socket);
  });

  it('can accept incoming connections and sends env info', () => {
    spyOn(socket, 'send');
    logger.connect(socket);

    expect(socket.send).toHaveBeenCalledOnceWith(
      '{"env":{"PERCY_LOGLEVEL":"info"}}'
    );
  });

  it('handles incoming messages from the remote logger', () => {
    let send = data => socket.client.send(JSON.stringify(data));
    logger.connect(socket);

    send({ logAll: [{ debug: 'test1', level: 'warn', message: 'Test 1' }] });
    send({ log: ['test2', 'info', 'Test 2'] });
    send({ foo: 'bar' });

    expect(helpers.stdout).toEqual(['[percy] Test 2']);
    expect(helpers.messages).toEqual(new Set([{
      debug: 'test1',
      level: 'warn',
      message: 'Test 1'
    }, {
      debug: 'test2',
      level: 'info',
      message: 'Test 2',
      timestamp: jasmine.any(Number),
      meta: {}
    }]));
  });

  it('returns a cleanup function when connecting from remote', () => {
    expect(socket.onmessage).toBeUndefined();
    let disconnect = logger.connect(socket);
    expect(socket.onmessage).toEqual(jasmine.any(Function));
    disconnect();
    expect(socket.onmessage).toBeNull();
  });
});
