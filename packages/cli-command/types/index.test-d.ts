import { expectType, expectError } from 'tsd';
import PercyCommand, { flags } from '@percy/cli-command';

// Augmented to allow percyrc
expectType<flags.PercyDefinition<string>>(
  flags.build({ percyrc: 'percy.build' }));
expectType<flags.PercyDefinition<boolean>>(
  flags.build<boolean>({ parse: i => !!i, percyrc: 'percy.build' }));
expectType<flags.PercyOptionFlag<string | undefined>>(
  flags.option<string>({ parse: i => i, percyrc: 'percy.option' }));
expectType<flags.PercyBooleanFlag<boolean>>(
  flags.boolean({ percyrc: 'percy.boolean' }));
expectType<flags.PercyBooleanFlag<any>>(
  flags.boolean<any>({ percyrc: 'percy.boolean' }));
expectType<flags.PercyOptionFlag<number | undefined>>(
  flags.integer({ percyrc: 'percy.number' }));
expectType<flags.PercyOptionFlag<number>>(
  flags.integer({ required: true, percyrc: 'percy.number' }));
expectType<flags.PercyOptionFlag<string | undefined>>(
  flags.string({ percyrc: 'percy.string' }));
expectType<flags.PercyOptionFlag<string>>(
  flags.string({ default: '', percyrc: 'percy.string' }));

// Inherited errors
expectError(flags.build<boolean>({ percyrc: 'percy.boolean' }));
expectError(flags.option<void>({ char: null, percyrc: 'percy.boolean' }));
expectError(flags.boolean({ default: 'string', percyrc: 'percy.boolean' }));
expectError(flags.integer({ description: 1234, percyrc: 'percy.boolean' }));
expectError(flags.string({ name: false, percyrc: 'percy.boolean' }));

// Included flags
expectType<flags.PercyOptionFlag<boolean>>(flags.logging.verbose);
expectType<flags.PercyOptionFlag<boolean>>(flags.logging.quiet);
expectType<flags.PercyOptionFlag<boolean>>(flags.logging.silent);
expectType<flags.PercyOptionFlag<string[]>>(flags.discovery['allowed-hostnames']);
expectType<flags.PercyOptionFlag<number>>(flags.discovery['network-idle-timeout']);
expectType<flags.PercyOptionFlag<boolean>>(flags.discovery['disable-cache']);
expectType<flags.PercyOptionFlag<string>>(flags.config.config);

// Command methods and properties
class TestCommand extends PercyCommand {
  async run() {
    expectType<boolean>(this.isPercyEnabled());
    expectType<{ [x: string]: any }>(this.percyrc());
    expectType<{ [x: string]: any }>(this.flags);
    expectType<{ [x: string]: any }>(this.args);
  }
}
