import logger from '@percy/logger/test/helpers';
import dedent from '@percy/core/test/helpers/dedent';
import command from '../src';

describe('Command', () => {
  beforeEach(() => {
    logger.mock();
  });

  it('is a function that runs an action', async () => {
    let test = command('foo', {}, () => (test.done = true));

    expect(test).toBeInstanceOf(Function);
    expect(test).not.toHaveProperty('done');
    expect(test.name).toEqual('foo');

    await test();

    expect(test).toHaveProperty('done', true);
  });

  it('provides the action with a namespaced logger', async () => {
    let test = command('foo', {
      description: 'Foo',
      commands: [command('bar', {
        description: 'Foobar',
        commands: [command('baz', {
          description: 'Foobarbaz'
        }, ({ log }) => {
          log.loglevel('debug');
          log.info('log baz');
        })]
      }, ({ log }) => {
        log.loglevel('debug');
        log.info('log bar');
      })]
    }, ({ log }) => {
      log.loglevel('debug');
      log.info('log foo');
    });

    await test();
    expect(logger.stdout).toContain('[percy:cli] log foo');

    await test(['bar']);
    expect(logger.stdout).toContain('[percy:cli:bar] log bar');

    await test(['bar:baz']);
    expect(logger.stdout).toContain('[percy:cli:bar:baz] log baz');
  });

  it('allows redefining global options', async () => {
    let test = command('test', {
      flags: [{
        name: 'verbose',
        type: 'level',
        default: 'debug',
        description: 'Replaces common flag'
      }, {
        name: 'qux',
        short: 'q',
        description: 'Replaces common short flag'
      }]
    }, () => {});

    await test(['--help']);

    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ test [options]

      Options:
        --verbose [level]  Replaces common flag (default: "debug")
        -q, --qux          Replaces common short flag

      Global options:
        --quiet            Log errors only
        -s, --silent       Log nothing
        -h, --help         Display command help
    ` + '\n']);
  });

  it('provides the action with a percy instance if needed', async () => {
    let test = command('foo', {
      percy: true
    }, ({ percy }) => {
      test.percy = percy;
    });

    await test();

    let { Percy } = await import('@percy/core');
    expect(test.percy).toBeInstanceOf(Percy);
  });

  it('does not provide a percy instance if percy is not enabled', async () => {
    let test = command('foo', {
      percy: true
    }, ({ percy }) => {
      test.percy = !!percy;
    });

    try {
      process.env.PERCY_ENABLE = '0';
      await test();

      expect(test.percy).toBe(false);
    } finally {
      delete process.env.PERCY_ENABLE;
    }
  });

  it('initializes the percy instance with provided percy options', async () => {
    let test = command('foo', {
      flags: [{
        name: 'client',
        type: 'info',
        percyrc: 'clientInfo'
      }],
      percy: {
        environmentInfo: 'env/456'
      }
    }, ({ percy }) => {
      test.client = percy.client;
    });

    await test(['--client', 'client/123']);

    expect(test.client.clientInfo).toEqual(new Set(['client/123']));
    expect(test.client.environmentInfo).toEqual(new Set(['env/456']));
  });

  it('handles logging unhandled action errors', async () => {
    let test = command('test', {}, () => {
      throw new Error('unhandled');
    });

    await expectAsync(test())
      .toBeRejectedWithError('unhandled');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: unhandled'
    ]);
  });

  it('handles maybe exiting on unhandled errors', async () => {
    let spy = spyOn(process, 'exit');

    let test = command('test', {
      exitOnError: true
    }, () => {
      throw new Error();
    });

    await expectAsync(test()).toBeRejected();
    expect(spy).toHaveBeenCalled();
  });

  it('handles graceful exit errors', async () => {
    let test = command('test', {
      args: [{
        name: 'code',
        parse: Number,
        required: true
      }, {
        name: 'message'
      }]
    }, ({ args, exit }) => {
      let { code, message } = args;

      // exercise coverage
      if (message && code >= 1) {
        message = new Error(message);
      }

      exit(code, message);
      test.never = true;
    });

    await test(['123']).catch(e => {
      expect(e).toHaveProperty('message', 'EEXIT: 123');
      expect(e).toHaveProperty('exitCode', 123);
    });

    expect(test).not.toHaveProperty('never');
    expect(logger.stderr).toEqual([]);

    logger.reset();

    await test(['456', 'Reason']).catch(e => {
      expect(e).toHaveProperty('message', 'Reason');
      expect(e).toHaveProperty('exitCode', 456);
    });

    expect(test).not.toHaveProperty('never');
    expect(logger.stderr).toEqual([
      '[percy] Error: Reason'
    ]);

    logger.reset();

    await test(['0', 'Warning']);

    expect(test).not.toHaveProperty('never');
    expect(logger.stderr).toEqual([
      '[percy] Warning'
    ]);
  });

  it('handles interrupting generator actions', async () => {
    let sleep = (ms, v) => new Promise(r => setTimeout(r, ms, v));

    let test = command('test', {}, async function*() {
      try {
        test.state = 'starting';
        test.state = yield sleep(100, 'started');
        test.state = yield sleep(300, 'finished');
      } catch (err) {
        test.state = err.signal;
        throw err;
      }
    });

    let testing = test();

    await sleep(10);
    expect(test.state).toEqual('starting');

    await sleep(200);
    expect(test.state).toEqual('started');

    // process listeners are added around the action
    process.emit('SIGINT');

    // interrupt is not considered an error
    await expectAsync(testing).toBeResolved();
    expect(test.state).toEqual('SIGINT');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([]);
  });
});
