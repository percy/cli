import * as cliCommand from '../src/index.js';

describe('index (public exports)', () => {
  it('re-exports the command, legacy, intelliStory and common-package surface', () => {
    expect(typeof cliCommand.default).toBe('function');
    expect(typeof cliCommand.command).toBe('function');
    expect(cliCommand._resetShutdownForTest).toBeDefined();
    expect(cliCommand.legacyCommand).toBeDefined();
    expect(cliCommand.flags).toBeDefined();
    expect(typeof cliCommand.applyIntelliStory).toBe('function');
    expect(cliCommand.IntelliStoryBailError.prototype).toBeInstanceOf(Error);
    expect(cliCommand.PercyConfig).toBeDefined();
    expect(cliCommand.logger).toBeDefined();
  });
});
