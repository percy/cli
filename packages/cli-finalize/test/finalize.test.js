import expect from 'expect';
import mockAPI from '@percy/client/test/helper';
import stdio from '@percy/logger/test/helper';
import { Finalize } from '../src/commands/finalize';

describe('percy finalize', () => {
  beforeEach(() => {
    process.env.PERCY_PARALLEL_TOTAL = '-1';
    mockAPI.start();
  });

  afterEach(() => {
    delete process.env.PERCY_PARALLEL_TOTAL;
    delete process.env.PERCY_ENABLE;
  });

  it('does nothing and logs when percy is not enabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await stdio.capture(() => Finalize.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy is disabled\n'
    ]);
  });

  it('logs an error when PERCY_PARALLEL_TOTAL is not -1', async () => {
    process.env.PERCY_PARALLEL_TOTAL = '5';

    await expect(stdio.capture(() => (
      Finalize.run([])
    ))).rejects.toThrow('EEXIT: 1');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] This command should only be used with PERCY_PARALLEL_TOTAL=-1\n',
      '[percy] Current value is "5"\n'
    ]);
  });

  it('gets parallel build info and finalizes all parallel builds', async () => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await stdio.capture(() => Finalize.run([]));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Finalizing parallel build...\n',
      '[percy] Finalized build #1: https://percy.io/test/test/123\n'
    ]);
  });
});
