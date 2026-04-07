import { fs } from '@percy/cli-command/test/helpers';
import {
  validateArchivePath,
  sanitizeFilename,
  serializeSnapshot,
  deserializeSnapshot,
  archiveSnapshot,
  readArchivedSnapshots
} from '../../src/archive.js';

describe('Unit / Archive', () => {
  describe('validateArchivePath', () => {
    it('resolves a valid path', () => {
      let result = validateArchivePath('/tmp/percy-archive');
      expect(result).toBe('/tmp/percy-archive');
    });

    it('resolves a relative path to absolute', () => {
      let result = validateArchivePath('./percy-archive');
      expect(result).toMatch(/\/percy-archive$/);
      expect(result).not.toContain('..');
    });
  });

  describe('sanitizeFilename', () => {
    it('replaces unsafe characters', () => {
      let result = sanitizeFilename('my/snapshot:name*"test"');
      expect(result).not.toMatch(/[/\\:*?"<>|]/);
    });

    it('truncates long names', () => {
      let longName = 'a'.repeat(300);
      let result = sanitizeFilename(longName);
      // 200 chars max + dash + 8 char hash
      expect(result.length).toBeLessThanOrEqual(210);
    });

    it('appends a hash for collision prevention', () => {
      let result1 = sanitizeFilename('snapshot A');
      let result2 = sanitizeFilename('snapshot B');
      expect(result1).not.toBe(result2);
    });

    it('produces deterministic filenames', () => {
      let result1 = sanitizeFilename('my snapshot');
      let result2 = sanitizeFilename('my snapshot');
      expect(result1).toBe(result2);
    });
  });

  describe('serializeSnapshot / deserializeSnapshot', () => {
    let snapshot;

    beforeEach(() => {
      snapshot = {
        name: 'Test Snapshot',
        url: 'http://localhost:8000',
        widths: [1280],
        minHeight: 1024,
        resources: [{
          url: 'http://localhost:8000/',
          sha: 'abc123',
          mimetype: 'text/html',
          root: true,
          content: Buffer.from('<p>Test</p>')
        }]
      };
    });

    it('round-trips a snapshot through serialize and deserialize', () => {
      let serialized = serializeSnapshot(snapshot);
      let deserialized = deserializeSnapshot(serialized);

      expect(deserialized.name).toBe('Test Snapshot');
      expect(deserialized.url).toBe('http://localhost:8000');
      expect(deserialized.widths).toEqual([1280]);
      expect(deserialized.resources).toHaveSize(1);
      expect(deserialized.resources[0].content).toEqual(Buffer.from('<p>Test</p>'));
    });

    it('base64-encodes resource content during serialization', () => {
      let serialized = serializeSnapshot(snapshot);
      expect(typeof serialized.resources[0].content).toBe('string');
      expect(serialized.resources[0].content).toBe(Buffer.from('<p>Test</p>').toString('base64'));
    });

    it('preserves all snapshot fields', () => {
      snapshot.percyCSS = '.hide { display: none; }';
      snapshot.enableJavaScript = true;
      snapshot.customField = 'preserved';

      let serialized = serializeSnapshot(snapshot);
      let deserialized = deserializeSnapshot(serialized);

      expect(deserialized.percyCSS).toBe('.hide { display: none; }');
      expect(deserialized.enableJavaScript).toBe(true);
      expect(deserialized.customField).toBe('preserved');
    });

    it('handles snapshots with no resources', () => {
      snapshot.resources = [];
      let serialized = serializeSnapshot(snapshot);
      expect(serialized.resources).toEqual([]);
    });

    it('handles resources with null content', () => {
      snapshot.resources[0].content = null;
      let serialized = serializeSnapshot(snapshot);
      let deserialized = deserializeSnapshot(serialized);
      expect(deserialized.resources[0].content).toBeNull();
    });

    it('rejects invalid archive data', () => {
      expect(() => deserializeSnapshot(null)).toThrowError('Invalid archive: expected an object');
      expect(() => deserializeSnapshot({ version: 99 })).toThrowError(/Unsupported archive version/);
      expect(() => deserializeSnapshot({ version: 1, snapshot: {} })).toThrowError(/missing snapshot name/);
      expect(() => deserializeSnapshot({ version: 1, snapshot: { name: 'x' }, resources: [] }))
        .toThrowError(/missing or empty resources/);
    });
  });

  describe('archiveSnapshot / readArchivedSnapshots', () => {
    let log;

    beforeEach(async () => {
      log = { warn: jasmine.createSpy('warn'), info: jasmine.createSpy('info') };
    });

    it('writes and reads back a snapshot', () => {
      let snapshot = {
        name: 'My Snapshot',
        url: 'http://localhost:8000',
        resources: [{
          url: 'http://localhost:8000/',
          sha: 'abc123',
          mimetype: 'text/html',
          root: true,
          content: Buffer.from('<p>Hello</p>')
        }]
      };

      let archivePath = '.test-archive';
      archiveSnapshot(archivePath, snapshot);

      let results = readArchivedSnapshots(archivePath, log);
      expect(results).toHaveSize(1);
      expect(results[0].name).toBe('My Snapshot');
      expect(results[0].resources[0].content).toEqual(Buffer.from('<p>Hello</p>'));
    });

    it('skips invalid files with warnings', () => {
      let archivePath = '.test-archive-invalid';
      fs.mkdirSync(archivePath, { recursive: true });
      fs.writeFileSync(`${archivePath}/bad.json`, '{ "not": "valid" }');

      let results = readArchivedSnapshots(archivePath, log);
      expect(results).toHaveSize(0);
      expect(log.warn).toHaveBeenCalledWith(
        jasmine.stringMatching(/Skipping invalid archive file/)
      );
    });

    it('throws when archive directory does not exist', () => {
      expect(() => readArchivedSnapshots('./nonexistent', log))
        .toThrowError(/Archive directory not found/);
    });
  });
});
