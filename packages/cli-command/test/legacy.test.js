import logger from '@percy/logger/test/helpers';
import dedent from '@percy/core/test/helpers/dedent';
import { command, legacyCommand, flags } from '../src';

describe('Legacy support', () => {
  let test;

  class LegacyClass extends command {
    static description = 'Class description';
    static examples = ['$0 bar'];
    static args = [{ name: 'foo' }];

    static flags = {
      ...flags.config,
      ...flags.logging,
      ...flags.discovery,
      bool: flags.boolean({
        description: 'Boolean flag'
      }),
      true: flags.boolean({
        description: 'Negated flag',
        default: true
      }),
      value: flags.string({
        description: 'String flag'
      }),
      optional: flags.string({
        description: 'Optional flag',
        default: 'opt'
      }),
      num: flags.integer({
        description: 'Integer flag',
        char: 'n'
      }),
      foo: flags.string({
        deprecated: { until: '1.0.0', map: 'value' }
      }),
      bar: flags.boolean({
        deprecated: { until: '1.0.0', alt: 'Sorry.' }
      }),
      baz: flags.boolean({
        deprecated: true
      })
    };

    run() {
      if (this.args.foo === 'throw') {
        this.error('Some error');
      } else {
        test.this = this;
      }
    }

    async finally(err) {
      if (!err && this.args.foo === 'wait') {
        while (!test.result) await new Promise(r => setImmediate(r));
      } else {
        test.result = err || true;
      }
    }
  }

  beforeEach(() => {
    test = legacyCommand('test', LegacyClass);
    logger.mock();
  });

  it('shows expected usage help', async () => {
    await test(['--help']);

    expect(test.this).toBeUndefined();
    expect(test.result).toBeUndefined();
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([jasmine.stringContaining(dedent`
      Class description

      Usage:
        $ test [options] [foo]

      Options:
        --bool                             Boolean flag
        --no-true                          Negated flag
        --value <string>                   String flag
        --optional [string]                Optional flag (default: "opt")
        -n, --num <integer>                Integer flag
    `)]);
    expect(logger.stdout).toEqual([jasmine.stringContaining(dedent`
      Examples:
        $ test bar
    `)]);
  });

  it('augments legacy instance properties', async () => {
    await test(['bar', '--bool', '--no-true', '--value=str', '-n10']);
    expect(test.result).toBe(true);

    let ctx = test.this.parse();
    expect(test.this.isPercyEnabled()).toBe(true);
    expect(test.this.log).toEqual(ctx.log);

    expect(test.this.percyrc({ foo: 'bar' })).toEqual({
      ...ctx.percy.config,
      config: false,
      foo: 'bar'
    });

    expect(test.this.args).toEqual(ctx.args);
    expect(test.this.args).toEqual({ foo: 'bar' });
    expect(test.this.flags).toEqual(ctx.flags);
    expect(test.this.flags).toEqual({
      bool: true,
      true: false,
      value: 'str',
      optional: 'opt',
      num: 10
    });
  });

  it('includes a static run method', async () => {
    expect(LegacyClass.run).toBeInstanceOf(Function);
    await LegacyClass.run(['bar', '--bool']);

    expect(test.result).toBe(true);
    expect(test.this.args).toHaveProperty('foo', 'bar');
    expect(test.this.flags).toHaveProperty('bool', true);
  });

  it('handles legacy deprecated flags', async () => {
    await test(['--foo=foo', '--bar', '--baz']);

    expect(test.result).toBe(true);
    expect(test.this.flags).not.toHaveProperty('foo');
    expect(test.this.flags).toHaveProperty('value', 'foo');
    expect(test.this.flags).toHaveProperty('bar', true);
    expect(test.this.flags).toHaveProperty('baz', true);

    expect(logger.stderr).toEqual([
      "[percy] Warning: The '--foo <string>' option will be removed in 1.0.0." +
        " Use '--value <string>' instead.",
      "[percy] Warning: The '--bar' option will be removed in 1.0.0. Sorry.",
      "[percy] Warning: The '--baz' option will be removed in a future release."
    ]);
  });

  it('handles legacy errors', async () => {
    await expectAsync(test(['throw'])).toBeRejectedWithError('EEXIT: 1');
    expect(test.result).toHaveProperty('message', 'Some error');
    expect(logger.stderr).toEqual(['[percy] Error: Some error']);
  });

  it('handles legacy process events', async () => {
    let waiting = test(['wait']);
    await new Promise(r => setTimeout(r, 50));

    process.emit('SIGTERM');
    await expectAsync(waiting).toBeResolved();

    expect(test.result).toHaveProperty('message', 'SIGTERM');
  });

  it('accepts other class-like commands', async () => {
    let test;

    class Test {
      run = () => (test = this);
    }

    class TestArgs extends Test {
      static args = [{ name: 'arg' }]
    }

    class TestFlags extends Test {
      static flags = {
        flag: {
          type: 'option',
          parse: foo => foo + 'bar'
        }
      };
    }

    let argsCmd = legacyCommand('test-args', TestArgs);
    let flagsCmd = legacyCommand('test-flags', TestFlags);

    await argsCmd(['foo']);
    expect(test.args).toHaveProperty('arg', 'foo');

    await flagsCmd(['--flag', 'foo']);
    expect(test.flags).toHaveProperty('flag', 'foobar');
  });
});
