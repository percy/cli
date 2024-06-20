import { logger, dedent } from './helpers.js';
import command from '@percy/cli-command';

describe('Help output', () => {
  beforeEach(async () => {
    await logger.mock();
  });

  it('is displayed by default when there is no action', async () => {
    let test = command('foo', {
      commands: [command('bar', {
        commands: [command('baz', {
          description: 'Foo bar baz'
        }, () => {})]
      })]
    });

    await test();
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ foo <command>

      Commands:
        bar:baz [options]           Foo bar baz
        help [command]              Display command help

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h, --help                  Display command help
    ` + '\n']);
  });

  it('is displayed when the --help flag is provided', async () => {
    let test = command('test', {
      description: 'Command description',
      args: [{
        name: 'first',
        description: 'First command argument',
        required: true
      }, {
        name: 'second',
        description: 'Second command argument',
        default: '2'
      }],
      flags: [{
        name: 'one',
        description: 'Command flag 1',
        short: 'o'
      }, {
        name: 'two',
        description: 'Command flag 2',
        type: 'value'
      }, {
        name: 'other-flag'
      }],
      commands: [
        command('sub', {
          flags: [{
            name: 'really-long',
            description: [
              'This is a really long description that should overflow',
              'the default description length and cause it to wrap',
              'to the right of flag usage.', '\n',
              '\nIt even includes a couple newlines in an attempt to trip up',
              'the string wrapping helper function.'
            ].join(' ')
          }],
          commands: [
            command('nested', {
              description: 'Nested description',
              commands: [command('deep', {
                description: 'Deeply nested description'
              }, () => {})],
              examples: ['$0']
            }, () => {
              test.done = true;
            })
          ]
        }, () => {
          test.done = true;
        })
      ],
      examples: [
        '$0 --one',
        '$0 -o --two 2'
      ]
    }, () => {
      test.done = true;
    });

    await test(['--help']);
    expect(test.done).not.toBe(true);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Command description

      Usage:
        $ test [options] <first> [second]

      Arguments:
        first                       First command argument
        second                      Second command argument (default: "2")

      Commands:
        sub [options]
        sub:nested [options]        Nested description
        help [command]              Display command help

      Options:
        -o, --one                   Command flag 1
        --two <value>               Command flag 2
        --other-flag

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h, --help                  Display command help

      Examples:
        $ test --one
        $ test -o --two 2
    ` + '\n']);

    logger.reset();
    await test(['sub', '-h']);
    expect(test.done).not.toBe(true);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ test sub [options]

      Subcommands:
        sub:nested [options]        Nested description
        sub:nested:deep [options]   Deeply nested description
        help [command]              Display command help

      Options:
        --really-long               This is a really long description that should overflow the default
                                    description length and cause it to wrap to the right of flag usage.

                                    It even includes a couple newlines in an attempt to trip up the
                                    string wrapping helper function.

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h, --help                  Display command help
    ` + '\n']);

    logger.reset();
    await test(['sub:nested', '-h']);
    expect(test.done).not.toBe(true);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Nested description

      Usage:
        $ test sub:nested [options]

      Subcommands:
        sub:nested:deep [options]   Deeply nested description
        help [command]              Display command help

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h, --help                  Display command help

      Examples:
        $ test sub:nested
    ` + '\n']);

    logger.reset();
    await test(['sub:nested:deep', '-h']);
    expect(test.done).not.toBe(true);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Deeply nested description

      Usage:
        $ test sub:nested:deep [options]

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h, --help                  Display command help
    ` + '\n']);
  });

  it('displays default usage info', async () => {
    let test = command('test');

    await test(['--help']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('$ test [options]')
    ]);
  });

  it('displays default usage info with args', async () => {
    let test = command('test', {
      args: [{
        name: 'first',
        required: true
      }, {
        name: 'second'
      }]
    });

    await test(['--help']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('$ test [options] <first> [second]')
    ]);
  });

  it('displays default usage info with subcommands', async () => {
    let test = command('test', {
      commands: [command('foo', {})]
    });

    await test(['help']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('$ test <command>')
    ]);
  });

  it('displays default usage info with args and subcommands', async () => {
    let test = command('test', {
      args: [{ name: 'arg' }],
      commands: [command('foo', {})]
    }, () => {});

    await test(['--help']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('$ test [options] [arg]')
    ]);
  });

  it('displays custom usage info when defined', async () => {
    let test = command('test', { usage: '(usage here)' });

    await test(['--help']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('$ test (usage here)')
    ]);
  });

  it('displays version information when defined', async () => {
    let test = command('foo', {
      version: 'foobar/1.2.3'
    });

    await test(['--help']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      jasmine.stringContaining('-V, --version')
    ]);

    logger.reset();
    await test(['--version']);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual(['foobar/1.2.3']);
  });

  it('does not display hidden or deprecated options', async () => {
    let test = command('test', {
      args: [{
        name: 'arg',
        default: 'foo'
      }, {
        name: 'hidden',
        hidden: true
      }, {
        name: 'deprecated',
        deprecated: true
      }],
      flags: [{
        name: 'flag'
      }, {
        name: 'hidden',
        hidden: true
      }, {
        name: 'deprecated',
        deprecated: true
      }],
      commands: [
        command('command', {}, () => {}),
        command('hidden', { hidden: true }, () => {})
      ]
    });

    await test();
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ test <command>

      Arguments:
        arg                         (default: "foo")

      Commands:
        command [options]
        help [command]              Display command help

      Options:
        --flag

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h, --help                  Display command help
    ` + '\n']);
  });

  it('does not display help or version flags when taken', async () => {
    let test = (long, short) => command('test', {
      version: 'foobar/1.2.3',
      flags: [{
        name: long && 'help',
        short: short && 'h',
        description: 'Custom help'
      }, {
        name: long && 'version',
        short: short && 'V',
        description: 'Custom version'
      }]
    })();

    await test(true);
    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ test [options]

      Options:
        --help                      Custom help
        --version                   Custom version

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        -h                          Display command help
        -V                          Display version
    ` + '\n']);

    logger.reset();
    await test(false, true);
    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ test [options]

      Options:
        -h                          Custom help
        -V                          Custom version

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
        --help                      Display command help
        --version                   Display version
    ` + '\n']);

    logger.reset();
    await test(true, true);
    expect(logger.stdout).toEqual([dedent`
      Usage:
        $ test [options]

      Options:
        -h, --help                  Custom help
        -V, --version               Custom version

      Global options:
        -v, --verbose               Log everything
        -q, --quiet                 Log errors only
        -s, --silent                Log nothing
        -bt, --build-tags <string>  Associates tags to the build (ex: --build-tag=dev,prod )
    ` + '\n']);
  });

  it('can log warnings for hidden commands', async () => {
    let test = command('test', {
      commands: [command('hidden', {
        hidden: 'this is hidden for a reason',
        commands: [command('nested', {}, () => {})]
      })]
    });

    await test(['hidden:nested']);

    expect(logger.stderr).toEqual([
      '\n[percy] Warning: this is hidden for a reason\n'
    ]);
  });
});
