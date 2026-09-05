// Registers the test loader's module customization hooks.
//
// Loaded with `node --import` (see scripts/test.js) rather than
// `--loader scripts/loader.js`, because `--loader` runs its hooks on a
// dedicated module thread from Node 20.6 onward. The suite's mocking works by
// sharing `global.__MOCK_IMPORTS__` between the hooks and the specs, which a
// separate thread cannot do -- tests would see `undefined` and every
// `__MOCK_IMPORTS__.set()` would throw.
//
// `module.registerHooks` (Node >=22.15) runs the hooks synchronously, in-process
// and in the same realm, which is the behaviour the old `--experimental-loader`
// had on Node 14. That is why this migration targets 22 and not 20: Node 20 only
// has the off-thread `module.register`, so it would need the mock registry moved
// onto a MessagePort with an ack before every dynamic import.
import { registerHooks } from 'module';
import { resolve, load } from './loader.js';

if (typeof registerHooks !== 'function') {
  throw new Error(
    'The test loader requires module.registerHooks (Node >=22.15). ' +
    `Running Node ${process.version}.`
  );
}

registerHooks({ resolve, load });
