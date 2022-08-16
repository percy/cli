import { setupTest } from '@percy/cli-command/test/helpers';
import * as ExecPlugin from '@percy/cli-exec';
import { exec, start, stop, ping } from '@percy/cli-app';

describe('percy app:exec', () => {
  beforeEach(async () => {
    await setupTest();
  });

  it('has shared exec commands with differing definitions', async () => {
    expect(exec.callback).toEqual(ExecPlugin.default.callback);
    expect(exec.definition).not.toEqual(ExecPlugin.default.definition);
    expect(start.callback).toEqual(ExecPlugin.start.callback);
    expect(start.definition).not.toEqual(ExecPlugin.start.definition);
    // stop and ping are actually exact references
    expect(stop).toEqual(ExecPlugin.stop);
    expect(ping).toEqual(ExecPlugin.ping);
  });

  it('does not accept asset discovery options', async () => {
    await expectAsync(exec(['--allowed-hostname', 'percy.io']))
      .toBeRejectedWithError("Unknown option '--allowed-hostname'");
    await expectAsync(start(['--network-idle-timeout', '500']))
      .toBeRejectedWithError("Unknown option '--network-idle-timeout'");
  });
});
