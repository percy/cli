import fs from 'fs';
import path from 'path';
import expect from 'expect';
import mockAPI from '@percy/client/test/helper';
import stdio from '@percy/logger/test/helper';
import { Upload } from '../src/commands/upload';

// http://png-pixel.com/
const pixel = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const cwd = process.cwd();

describe('percy upload', () => {
  before(() => {
    require('../src/hooks/init').default();

    fs.mkdirSync(path.join(__dirname, 'tmp'));
    process.chdir(path.join(__dirname, 'tmp'));

    fs.mkdirSync('images');
    fs.writeFileSync(path.join('images', 'test-1.png'), pixel);
    fs.writeFileSync(path.join('images', 'test-2.jpg'), pixel);
    fs.writeFileSync(path.join('images', 'test-3.jpeg'), pixel);
    fs.writeFileSync(path.join('images', 'test-4.gif'), pixel);
    fs.writeFileSync('nope', 'not here');
  });

  after(() => {
    fs.unlinkSync('nope');
    fs.unlinkSync(path.join('images', 'test-1.png'));
    fs.unlinkSync(path.join('images', 'test-2.jpg'));
    fs.unlinkSync(path.join('images', 'test-3.jpeg'));
    fs.unlinkSync(path.join('images', 'test-4.gif'));
    fs.rmdirSync('images');

    process.chdir(cwd);
    fs.rmdirSync(path.join(__dirname, 'tmp'));
  });

  beforeEach(() => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    mockAPI.start();
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
  });

  it('skips uploading when percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';

    await stdio.capture(() => Upload.run(['./images']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual(['[percy] Percy is disabled. Skipping upload\n']);
  });

  it('errors when the directory is not found', async () => {
    await expect(stdio.capture(() => (
      Upload.run(['./404'])
    ))).rejects.toThrow('Not found: ./404');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: Not found: ./404\n'
    ]);
  });

  it('errors when the path is not a directory', async () => {
    await expect(stdio.capture(() => (
      Upload.run(['./nope'])
    ))).rejects.toThrow('Not a directory: ./nope');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: Not a directory: ./nope\n'
    ]);
  });

  it('errors when there are no matching files', async () => {
    await expect(stdio.capture(() => (
      Upload.run(['./images', '--files=no-match.png'])
    ))).rejects.toThrow('No matching files found in \'./images\'');

    expect(stdio[1]).toHaveLength(0);
    expect(stdio[2]).toEqual([
      '[percy] Error: No matching files found in \'./images\'\n'
    ]);
  });

  it('creates a new build and uploads snapshots', async () => {
    await stdio.capture(() => Upload.run(['./images']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy has started!\n',
      '[percy] Created build #1: https://percy.io/test/test/123\n',
      '[percy] Snapshot uploaded: test-1.png\n',
      '[percy] Snapshot uploaded: test-2.jpg\n',
      '[percy] Snapshot uploaded: test-3.jpeg\n',
      '[percy] Finalized build #1: https://percy.io/test/test/123\n'
    ]);
  });

  it('skips unsupported image types', async () => {
    await stdio.capture(() => Upload.run(['./images', '--files=*']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Percy has started!\n',
      '[percy] Created build #1: https://percy.io/test/test/123\n',
      '[percy] Snapshot uploaded: test-1.png\n',
      '[percy] Snapshot uploaded: test-2.jpg\n',
      '[percy] Snapshot uploaded: test-3.jpeg\n',
      '[percy] Skipping unsupported image type: test-4.gif\n',
      '[percy] Finalized build #1: https://percy.io/test/test/123\n'
    ]);
  });

  it('does not upload snapshots and prints matching files with --dry-run', async () => {
    await stdio.capture(() => Upload.run(['./images', '--dry-run']));

    expect(stdio[2]).toHaveLength(0);
    expect(stdio[1]).toEqual([
      '[percy] Matching files:\n',
      'test-1.png\n',
      'test-2.jpg\n',
      'test-3.jpeg\n'
    ]);
  });
});
