import { expectType, expectError } from 'tsd';
import PercyConfig, { PercyConfigObject } from '@percy/config';

// .load()
expectType<PercyConfigObject>(PercyConfig.load());
expectType<PercyConfigObject>(PercyConfig.load({ filepath: false }));
expectType<PercyConfigObject>(PercyConfig.load({ filepath: undefined }));
expectType<PercyConfigObject>(PercyConfig.load({
  filepath: '.percy.yml',
  overrides: { foo: 'bar' },
  reload: true,
  bail: true
}));

expectError(PercyConfig.load({ filepath: true }));
expectError(PercyConfig.load({ overrides: null }));

// .validate()
expectType<boolean>(PercyConfig.validate({ version: 2, foo: 'bar' }));
expectType<boolean>(PercyConfig.validate({ version: 2 }, { scrub: true }));

expectError(PercyConfig.validate());
expectError(PercyConfig.validate({}));
expectError(PercyConfig.validate({ version: 2 }, { foo: 'bar' }));

// .addSchema()
expectType<void>(PercyConfig.addSchema({ foo: { type: 'string' } }));

expectError(PercyConfig.addSchema({ foo: { type: 'foobar' } }));

// .getDefaults()
expectType<PercyConfigObject>(PercyConfig.getDefaults());
expectType<PercyConfigObject>(PercyConfig.getDefaults({ foo: 'bar' }));

expectError(PercyConfig.getDefaults(null));

// .stringify()
expectType<string>(PercyConfig.stringify('yaml'))
expectType<string>(PercyConfig.stringify('json'))
expectType<string>(PercyConfig.stringify('js'))
expectType<string>(PercyConfig.stringify('yaml', { version: 2 }))

expectError(PercyConfig.stringify())
expectError(PercyConfig.stringify('foo'))
expectError(PercyConfig.stringify('yaml', { foo: 'bar' }))
