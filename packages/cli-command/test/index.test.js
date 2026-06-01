import * as cliCommand from '../src/index.js';

// The barrel only re-exports; importing and touching each binding is enough to
// execute it. Guards against an export being dropped or renamed.
describe('index (public exports)', () => {
  it('re-exports the command, legacy, smartsnap and common-package surface', () => {
    expect(typeof cliCommand.default).toBe('function');
    expect(typeof cliCommand.command).toBe('function');
    expect(cliCommand._resetShutdownForTest).toBeDefined();
    expect(cliCommand.legacyCommand).toBeDefined();
    expect(cliCommand.flags).toBeDefined();
    expect(typeof cliCommand.applySmartSnap).toBe('function');
    expect(cliCommand.SmartSnapBailError.prototype).toBeInstanceOf(Error);
    expect(cliCommand.PercyConfig).toBeDefined();
    expect(cliCommand.logger).toBeDefined();
  });
});
