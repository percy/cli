import fs from 'fs';
import path from 'path';
import { inspect } from 'util';
import mockAPI from '@percy/client/test/helpers';
import logger from '@percy/logger/test/helpers';
import { createTestServer } from '@percy/core/test/helpers';
import { Snapshot } from '../src/commands/snapshot';

const cwd = process.cwd();

describe('percy snapshot', () => {
  beforeAll(() => {
    require('../src/hooks/init').default();

    fs.mkdirSync(path.join(__dirname, 'tmp'));
    process.chdir(path.join(__dirname, 'tmp'));

    fs.mkdirSync('public');
    fs.writeFileSync(path.join('public', 'test-1.html'), '<p>Test 1</p>');
    fs.writeFileSync(path.join('public', 'test-2.html'), '<p>Test 2</p>');
    fs.writeFileSync(path.join('public', 'test-3.htm'), '<p>Test 3</p>');
    fs.writeFileSync(path.join('public', 'test-4.xml'), '<p>Test 4</p>');
    fs.writeFileSync('pages.yml', [
      '- name: YAML Snapshot',
      '  url: http://localhost:8000'
    ].join('\n'));
    fs.writeFileSync('pages.json', JSON.stringify([{
      name: 'JSON Snapshot',
      url: 'http://localhost:8000'
    }]));
    fs.writeFileSync('pages.js', 'module.exports = ' + inspect([{
      name: 'JS Snapshot',
      url: 'http://localhost:8000',
      additionalSnapshots: [
        { suffix: ' 2' },
        { prefix: 'Other ' }
      ]
    }], { depth: null }));
    fs.writeFileSync('pages-fn.js', 'module.exports = () => (' + inspect([{
      name: 'JS Function Snapshot',
      url: 'http://localhost:8000'
    }], { depth: null }) + ')');
    fs.writeFileSync('nope', 'not here');
  });

  afterAll(() => {
    fs.unlinkSync('nope');
    fs.unlinkSync('pages.js');
    fs.unlinkSync('pages-fn.js');
    fs.unlinkSync('pages.json');
    fs.unlinkSync('pages.yml');
    fs.unlinkSync(path.join('public', 'test-1.html'));
    fs.unlinkSync(path.join('public', 'test-2.html'));
    fs.unlinkSync(path.join('public', 'test-3.htm'));
    fs.unlinkSync(path.join('public', 'test-4.xml'));
    fs.rmdirSync('public');

    process.chdir(cwd);
    fs.rmdirSync(path.join(__dirname, 'tmp'));
  });

  beforeEach(() => {
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    mockAPI.start(50);
    logger.mock();
  });

  afterEach(() => {
    delete process.env.PERCY_TOKEN;
    delete process.env.PERCY_ENABLE;
    process.removeAllListeners();
  });

  it('skips snapshotting when Percy is disabled', async () => {
    process.env.PERCY_ENABLE = '0';
    await Snapshot.run(['./public']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Percy is disabled. Skipping snapshots'
    ]);
  });

  it('errors when the provided path doesn\'t exist', async () => {
    await expectAsync(Snapshot.run(['./404'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: Not found: ./404'
    ]);
  });

  it('errors when the base-url is invalid', async () => {
    await expectAsync(Snapshot.run(['./public', '--base-url=wrong'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: The base-url flag must begin with a forward slash (/)'
    ]);
  });

  it('errors when there are no snapshots to take', async () => {
    await expectAsync(Snapshot.run(['./public', '--files=no-match'])).toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: No snapshots found'
    ]);
  });

  describe('snapshotting static directories', () => {
    it('starts a static server and snapshots matching files', async () => {
      await Snapshot.run(['./public']);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: /test-3.htm',
        '[percy] Snapshot taken: /test-2.html',
        '[percy] Snapshot taken: /test-1.html',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]));
    });

    it('snapshots matching files hosted with a base-url', async () => {
      await Snapshot.run(['./public', '--base-url=/base/']);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual(jasmine.arrayContaining([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: /base/test-3.htm',
        '[percy] Snapshot taken: /base/test-2.html',
        '[percy] Snapshot taken: /base/test-1.html',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]));
    });

    it('does not take snapshots and prints a list with --dry-run', async () => {
      await Snapshot.run(['./public', '--dry-run']);
      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Found 3 snapshots:\n' +
          '/test-1.html\n' +
          '/test-2.html\n' +
          '/test-3.htm'
      ]);
    });
  });

  describe('snapshotting a list of pages', () => {
    let server;

    beforeEach(async () => {
      server = await createTestServer({
        default: () => [200, 'text/html', '<p>Test</p>']
      });
    });

    afterEach(async () => {
      await server.close();
    });

    it('snapshots pages from .yaml files', async () => {
      await Snapshot.run(['./pages.yml']);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: YAML Snapshot',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]);
    });

    it('snapshots pages from .json files', async () => {
      await Snapshot.run(['./pages.json']);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: JSON Snapshot',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]);
    });

    it('snapshots pages from .js files', async () => {
      await Snapshot.run(['./pages.js']);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: JS Snapshot',
        '[percy] Snapshot taken: JS Snapshot 2',
        '[percy] Snapshot taken: Other JS Snapshot',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]);
    });

    it('snapshots pages from .js files that export a function', async () => {
      await Snapshot.run(['./pages-fn.js']);

      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Percy has started!',
        '[percy] Snapshot taken: JS Function Snapshot',
        '[percy] Finalized build #1: https://percy.io/test/test/123'
      ]);
    });

    it('errors with unknown file extensions', async () => {
      await expectAsync(Snapshot.run(['./nope'])).toBeRejectedWithError('EEXIT: 1');

      expect(logger.stdout).toEqual([]);
      expect(logger.stderr).toEqual([
        '[percy] Error: Unsupported filetype: ./nope'
      ]);
    });

    it('does not take snapshots and prints a list with --dry-run', async () => {
      await Snapshot.run(['./pages.yml', '--dry-run']);
      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Found 1 snapshot:\n' +
          'YAML Snapshot'
      ]);

      logger.reset();

      await Snapshot.run(['./pages.js', '--dry-run']);
      expect(logger.stderr).toEqual([]);
      expect(logger.stdout).toEqual([
        '[percy] Found 3 snapshots:\n' +
          'JS Snapshot\n' +
          'JS Snapshot 2\n' +
          'Other JS Snapshot'
      ]);
    });
  });
});
