// Minimum TypeScript Version: 3.8
import Command from '@oclif/command';
import * as Parser from '@oclif/parser';

export namespace flags {
  interface PercyFlagBase { percyrc?: string }
  interface PercyOptionFlag<T> extends PercyFlagBase, Parser.flags.IOptionFlag<T> {}
  interface PercyBooleanFlag<T> extends PercyFlagBase, Parser.flags.IBooleanFlag<T> {}
  interface PercyDefinition<T> extends Parser.flags.Definition<T> {
    (options: { multiple: true } & Partial<PercyOptionFlag<T[]>>): PercyOptionFlag<T[]>;
    (options: ({ required: true } | { default: Parser.flags.Default<T> }) & Partial<PercyOptionFlag<T>>): PercyOptionFlag<T>;
    (options?: Partial<PercyOptionFlag<T>>): PercyOptionFlag<T | undefined>;
  }

  type PercyParseOptions<T> = { parse: PercyOptionFlag<T>['parse'] } & Partial<PercyOptionFlag<T>>;
  function build<T>(defaults: PercyParseOptions<T>): PercyDefinition<T>;
  function build(defaults: Partial<PercyOptionFlag<string>>): PercyDefinition<string>;
  function option<T>(options: PercyParseOptions<T>): PercyOptionFlag<T | undefined>;
  function boolean<T = boolean>(options?: Partial<PercyBooleanFlag<T>>): PercyBooleanFlag<T>;
  const integer: PercyDefinition<number>;
  const string: PercyDefinition<string>;

  const logging: {
    verbose: PercyOptionFlag<boolean>,
    quiet: PercyOptionFlag<boolean>,
    silent: PercyOptionFlag<boolean>
  };

  const discovery: {
    ['allowed-hostnames']: PercyOptionFlag<string[]>,
    ['network-idle-timeout']: PercyOptionFlag<number>,
    ['disable-cache']: PercyOptionFlag<boolean>
  };

  const config: {
    config: PercyOptionFlag<string>
  };
}

export default abstract class PercyCommand extends Command {
  isPercyEnabled(): boolean
  percyrc(): { [x: string]: any }
  flags: { [x: string]: any }
  args: { [x: string]: any }
}
