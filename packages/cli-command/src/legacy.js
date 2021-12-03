import { command } from './command';
import { merge } from '@percy/config/dist/utils';

// Legacy flags for older commands that inadvertently import a newer @percy/cli-command
export const legacyFlags = {
  config: {},
  logging: {},
  discovery: { __percy__: {} },
  string: def => ({ type: 'string', ...def }),
  boolean: def => ({ type: 'boolean', ...def }),
  integer: def => ({ type: 'integer', ...def })
};

// Maps a legacy arg that might have alternate properties
function legacyArg(legacy) {
  let { name, ...def } = legacy;
  // do not camelcase legacy attribute names
  def.attribute = name;
  // add name back to mapped options
  return { name, ...def };
}

// Maps a legacy flag that might have alternate properties
function legacyFlag(name, legacy) {
  let { char: short, deprecated, ...def } = legacy;
  // generic legacy type looks odd in help output
  if (def.type === 'option') def.type = 'value';
  // do not camelcase legacy attribute names
  def.attribute = name;

  // transform legacy deprecated syntax
  if (deprecated) {
    let { until, map, alt } = deprecated !== true ? deprecated : {};
    def.deprecated = [until, map ? `--${map}` : alt];
  }

  // add name and mapped short option
  return { name, short, ...def };
}

// Maps a legacy class-based command to the new functional syntax
export function legacyCommand(name, constructor) {
  let runner = command(name, {
    description: constructor.description,
    examples: constructor.examples,

    // map legacy args and flags
    args: constructor.args?.map(legacyArg),
    flags: Object.entries(constructor.flags ?? [])
      .map(([name, def]) => legacyFlag(name, def))
      .filter(({ name }) => name !== '__percy__'),

    percy: constructor.flags?.__percy__ ?? true,
    loose: constructor.strict === false,
    legacy: true
  }, async function*(ctx) {
    let instance = new constructor();
    let error;

    // not an instance of the constructor, create one ourself
    if (!(instance instanceof constructor)) {
      instance = Object.create(constructor.prototype);
    }

    // legacy percyrc value
    let percyrc = overrides => merge([ctx.percy.config, overrides, {
      dryRun: ctx.flags.dryRun || ctx.flags['dry-run'],
      skipUploads: ctx.flags.debug,
      config: false
    }], (path, prev, next) => (
      // do not merge arrays
      Array.isArray(next) && [path, next]
    ));

    // augment legacy instance properties
    Object.defineProperties(instance, {
      isPercyEnabled: { value: () => !!ctx.percy },
      error: { value: msg => ctx.exit(1, msg) },
      parse: { value: () => ctx },
      percyrc: { value: percyrc },
      flags: { value: ctx.flags },
      args: { value: ctx.args },
      exit: { value: ctx.exit },
      log: { value: ctx.log }
    });

    // legacy signal handling
    let signals = ['SIGHUP', 'SIGINT', 'SIGTERM'];
    let cleanup = () => instance.finally(new Error('SIGTERM'));
    for (let e of signals) process.on(e, cleanup);

    // run and handle legacy command
    try {
      yield instance.run();
    } catch (err) {
      throw (error = err);
    } finally {
      await instance.finally?.(error);
      for (let e of signals) process.off(e, cleanup);
    }
  });

  // throw legacy errors for test compatibility
  return Object.defineProperties(args => runner(args).catch(e => {
    throw new Error(`EEXIT: ${e.exitCode}`);
  }), Object.getOwnPropertyDescriptors(runner));
}

// Support the legacy static run method
command.run = function run(args) {
  return legacyCommand('legacy', this)(args);
};

export default legacyCommand;
