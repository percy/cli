import { logger } from './helpers';
import command from '../src';

describe('Option parsing', () => {
  let cmd = (name, def) => {
    let test = command(name, def,
      ({ flags, args, argv }) => {
        test.flags = flags;
        test.args = args;
        test.argv = argv;
      });
    return test;
  };

  beforeEach(async () => {
    await logger.mock();
  });

  it('parses any provided command-line options', async () => {
    let test = cmd('foo', {
      args: [{ name: 'bar' }],
      flags: [{ name: 'baz' }]
    });

    await test(['foobar', '--baz']);
    expect(test.args).toHaveProperty('bar', 'foobar');
    expect(test.flags).toHaveProperty('baz', true);
  });

  it('errors when parsing unknown options', async () => {
    let test = cmd('foo', {
      args: [{ name: 'bar' }],
      flags: [{ name: 'baz' }]
    });

    await expectAsync(test(['--qux']))
      .toBeRejectedWithError("Unknown option '--qux'");
    await expectAsync(test(['foo', 'xyzzy']))
      .toBeRejectedWithError("Unexpected argument 'xyzzy'");
  });

  it('optionally accepts nested commands', async () => {
    let bar = cmd('bar', { loose: true });
    let foo = cmd('foo', { commands: () => [bar] });
    let test = cmd('test', { commands: [foo] });

    await test(['help']);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('foo:bar')
    ]);

    await test(['foo', 'bar', 'baz']);
    expect(test.argv).toBeUndefined();
    expect(foo.argv).toBeUndefined();
    expect(bar.argv).toEqual(['baz']);
  });

  it('errors when parsing unknown commands', async () => {
    let foo = cmd('foo', { commands: [cmd('bar')] });
    let test = cmd('test', { commands: [foo] });

    await expectAsync(test(['foo:baz']))
      .toBeRejectedWithError("Unexpected argument 'foo:baz'");
    await expectAsync(test(['foo', 'baz']))
      .toBeRejectedWithError("Unexpected argument 'baz'");

    await expectAsync(test(['foo:bar'])).toBeResolved();
    await expectAsync(test(['foo', 'bar'])).toBeResolved();
  });

  it('allows unknown options when `loose` is true', async () => {
    let test = cmd('test', {
      args: [{ name: 'arg' }],
      flags: [{ name: 'flag' }],
      loose: true
    });

    await test(['--flag', 'foo', 'bar', '--baz=qux']);
    expect(test.args).toHaveProperty('arg', 'foo');
    expect(test.flags).toHaveProperty('flag', true);
    expect(test.argv).toEqual(['bar', '--baz=qux']);
  });

  it('warns when providing unknown options when `loose` is a string', async () => {
    let test = cmd('test', {
      args: [{ name: 'arg' }],
      flags: [{ name: 'flag' }],
      loose: 'There are unknown options'
    });

    await test(['--flag', 'foo', 'bar', '--baz=qux']);
    expect(test.args).toHaveProperty('arg', 'foo');
    expect(test.flags).toHaveProperty('flag', true);
    expect(test.argv).toEqual(['bar', '--baz=qux']);
    expect(logger.stderr).toEqual([
      '[percy] There are unknown options'
    ]);
  });

  it('handles multiple short options provided together', async () => {
    let test = cmd('test', {
      flags: [
        { short: 'a' },
        { short: 'b' },
        { short: 'c', type: 'value' },
        { short: 'd', type: 'integer' }
      ]
    });

    await test(['-abcdef']);
    expect(test.flags).toHaveProperty('a', true);
    expect(test.flags).toHaveProperty('b', true);
    expect(test.flags).toHaveProperty('c', 'def');
    expect(test.flags).not.toHaveProperty('d');

    await test(['-abc', '123', '-d=10']);
    expect(test.flags).toHaveProperty('a', true);
    expect(test.flags).toHaveProperty('b', true);
    expect(test.flags).toHaveProperty('c', '123');
    expect(test.flags).toHaveProperty('d', 10);
  });

  it('handles potentially confusing options', async () => {
    let test = cmd('test', {
      loose: true,
      args: [{ name: 'arg' }],
      flags: [{
        name: 'flag',
        type: 'value',
        multiple: true
      }]
    });

    await test([
      '--flag', 'normal flag',
      '--not a flag',
      '--flag=--is a flag',
      '--not a --flag=nope'
    ]);

    expect(test.args).toHaveProperty('arg', '--not a flag');
    expect(test.flags).toHaveProperty('flag', ['normal flag', '--is a flag']);
    expect(test.argv).toEqual(['--not a --flag=nope']);
  });

  it('does not process options after --', async () => {
    let test = cmd('test', {
      args: [{ name: 'arg' }],
      flags: [{ name: 'flag' }]
    });

    await test(['--flag', '--', 'foo', 'bar', '--flag=baz']);
    expect(test.args).not.toHaveProperty('arg');
    expect(test.flags).toHaveProperty('flag', true);
    expect(test.argv).toEqual(['foo', 'bar', '--flag=baz']);
  });

  it('errors when providing invalid options', async () => {
    let test = cmd('test', {
      args: [{
        name: 'foo',
        required: true
      }, {
        name: 'bar',
        validate: val => {
          if (val && !/ba(r|z)/.test(val)) {
            throw new Error('Not bar or baz');
          }
        }
      }],
      flags: [{
        name: 'one',
        inclusive: ['two']
      }, {
        name: 'two',
        exclusive: ['three']
      }, {
        name: 'three',
        type: 'value'
      }, {
        name: 'nan',
        type: 'NaN',
        validate: val => {
          if (Number.isInteger(parseInt(val, 10))) {
            throw new Error('Is a number');
          }
        }
      }]
    });

    await expectAsync(test([]))
      .toBeRejectedWithError("Missing required argument 'foo'");
    await expectAsync(test(['foo', 'foo']))
      .toBeRejectedWithError('Not bar or baz');
    await expectAsync(test(['foo', '--one']))
      .toBeRejectedWithError("Options must be used together: '--one', '--two'");
    await expectAsync(test(['foo', '--one=two']))
      .toBeRejectedWithError("Unexpected option argument for '--one'");
    await expectAsync(test(['foo', '--two', '--three', 'four']))
      .toBeRejectedWithError("Options cannot be used together: '--two', '--three <value>'");
    await expectAsync(test(['foo', '--three']))
      .toBeRejectedWithError("Missing option argument for '--three <value>'");
    await expectAsync(test(['foo', '--nan', '200']))
      .toBeRejectedWithError('Is a number');

    await test(['bar', '--one', '--two']);
    expect(test.args).toHaveProperty('foo', 'bar');
    expect(test.flags).toHaveProperty('one', true);
    expect(test.flags).toHaveProperty('two', true);

    await test(['bar', '--three', 'four']);
    expect(test.args).toHaveProperty('foo', 'bar');
    expect(test.flags).toHaveProperty('three', 'four');
  });

  it('can map option attribute names by value', async () => {
    let test = cmd('test', {
      args: [{
        name: 'arg-1',
        attribute: 'one'
      }, {
        name: 'arg-2',
        attribute: v => v === 'bar' ? 'foo' : 'two'
      }],
      flags: [{
        name: 'flag-1',
        attribute: 'one'
      }, {
        name: 'flag-2',
        type: 'string',
        attribute: v => v === 'bar' ? 'foo' : 'two'
      }]
    });

    await test(['1', '2', '--flag-1', '--flag-2', '2']);
    expect(test.args).toHaveProperty('one', '1');
    expect(test.args).toHaveProperty('two', '2');
    expect(test.flags).toHaveProperty('one', true);
    expect(test.flags).toHaveProperty('two', '2');

    await test(['foo', 'bar', '--flag-1', '--flag-2', 'bar']);
    expect(test.args).toHaveProperty('one', 'foo');
    expect(test.args).toHaveProperty('foo', 'bar');
    expect(test.args).not.toHaveProperty('two');
    expect(test.flags).toHaveProperty('one', true);
    expect(test.flags).toHaveProperty('foo', 'bar');
    expect(test.flags).not.toHaveProperty('two');
  });

  it('will map and log warnings for deprecated options', async () => {
    let test = cmd('test', {
      flags: [{
        name: 'not-wrong-1',
        type: 'value',
        attribute: 'correct1'
      }, {
        name: 'not-wrong-2',
        type: 'value',
        attribute: 'correct2'
      }, {
        name: 'wrong-1',
        type: 'value',
        deprecated: true,
        attribute: 'wrong'
      }, {
        name: 'wrong-2',
        type: 'value',
        deprecated: '1.0.0',
        attribute: 'stillWrong'
      }, {
        name: 'wrong-3',
        type: 'value',
        deprecated: ['1.0.0', '--not-wrong-1']
      }, {
        name: 'wrong-4',
        type: 'value',
        deprecated: ['1.0.0', 'Try something else.']
      }],
      args: [{
        name: 'wrong-arg-1',
        deprecated: ['1.0.0', '--not-wrong-2']
      }, {
        name: 'wrong-arg-2',
        deprecated: ['1.0.0', '--wrong-flag']
      }, {
        name: 'wrong-arg-3',
        deprecated: true,
        default: 'no-arg'
      }]
    });

    await test([
      '--wrong-1=flag-1',
      '--wrong-2=flag-2',
      '--wrong-3=flag-3',
      '--wrong-4=flag-4',
      'arg-1',
      'arg-2'
    ]);

    expect(logger.stderr).toEqual([
      "[percy] Warning: The '--wrong-1 <value>' option will be removed in a future release.",
      "[percy] Warning: The '--wrong-2 <value>' option will be removed in 1.0.0.",
      "[percy] Warning: The '--wrong-3 <value>' option will be removed in 1.0.0." +
        " Use '--not-wrong-1 <value>' instead.",
      "[percy] Warning: The '--wrong-4 <value>' option will be removed in 1.0.0." +
        ' Try something else.',
      "[percy] Warning: The 'wrong-arg-1' argument will be removed in 1.0.0." +
        " Use '--not-wrong-2 <value>' instead.",
      "[percy] Warning: The 'wrong-arg-2' argument will be removed in 1.0.0."
    ]);

    expect(test.args).toEqual({
      wrongArg2: 'arg-2',
      wrongArg3: 'no-arg'
    });
    expect(test.flags).toEqual({
      wrong: 'flag-1',
      stillWrong: 'flag-2',
      correct1: 'flag-3',
      correct2: 'arg-1',
      wrong4: 'flag-4'
    });
  });

  it('can parse options defined by environment variables', async () => {
    let test = cmd('test', {
      args: [{
        name: 'arg-1',
        env: 'TEST_ARG_1'
      }, {
        name: 'arg-2',
        env: 'TEST_ARG_2',
        type: 'integer'
      }, {
        name: 'arg-3',
        env: 'TEST_ARG_3'
      }],
      flags: [{
        name: 'flag-1',
        env: 'TEST_FLAG_1'
      }, {
        name: 'flag-2',
        env: 'TEST_FLAG_2',
        type: 'boolean'
      }, {
        name: 'flag-3',
        env: 'TEST_FLAG_3',
        default: true
      }, {
        name: 'flag-4',
        env: 'TEST_FLAG_4',
        type: 'value',
        parse: v => v.toUpperCase()
      }]
    });

    try {
      process.env.TEST_ARG_1 = '1 arg';
      process.env.TEST_ARG_2 = '2 arg';
      process.env.TEST_FLAG_1 = '1 flag';
      process.env.TEST_FLAG_2 = '0';
      process.env.TEST_FLAG_3 = 'false';
      process.env.TEST_FLAG_4 = '4 flag';

      await test();

      expect(test.args).toHaveProperty('arg1', '1 arg');
      expect(test.args).toHaveProperty('arg2', 2);
      expect(test.args).not.toHaveProperty('arg3');

      expect(test.flags).toHaveProperty('flag1', true);
      expect(test.flags).toHaveProperty('flag2', false);
      expect(test.flags).toHaveProperty('flag3', false);
      expect(test.flags).toHaveProperty('flag4', '4 FLAG');
    } finally {
      delete process.env.TEST_ARG_1;
      delete process.env.TEST_ARG_2;
      delete process.env.TEST_FLAG_1;
      delete process.env.TEST_FLAG_2;
      delete process.env.TEST_FLAG_3;
      delete process.env.TEST_FLAG_4;
    }
  });

  it('can custom parse provided option values', async () => {
    let test = cmd('test', {
      args: [{
        name: 'num',
        parse: Number
      }, {
        name: 'foo',
        default: 'bar'
      }],
      flags: [{
        name: 'baz',
        type: 'upcase',
        parse: v => v.toUpperCase(),
        default: 'qux'
      }]
    });

    await test(['123']);
    expect(test.args).toHaveProperty('num', 123);
    expect(test.args).toHaveProperty('foo', 'bar');
    expect(test.flags).toHaveProperty('baz', 'qux');

    await test(['456', '789', '--baz', 'ten']);
    expect(test.args).toHaveProperty('num', 456);
    expect(test.args).toHaveProperty('foo', '789');
    expect(test.flags).toHaveProperty('baz', 'TEN');
  });
});
