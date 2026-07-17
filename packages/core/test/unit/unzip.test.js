import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import unzip from '../../src/unzip.js';

// minimal crc32 used to craft valid zip fixtures (zlib.crc32 requires node 20+)
function crc32(buf) {
  let crc = ~0;

  for (let byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }

  return ~crc >>> 0;
}

// builds a zip buffer from entry descriptors: { name, data, mode, deflate }
function makeZip(entries) {
  let locals = [];
  let centrals = [];
  let offset = 0;

  for (let { name, data = '', mode = 0o644, deflate = false } of entries) {
    let nameBuf = Buffer.from(name);
    let contents = Buffer.from(data);
    let crc = crc32(contents);
    let stored = deflate ? zlib.deflateRawSync(contents) : contents;
    let method = deflate ? 8 : 0;

    let local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, stored);

    let central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // version made by unix
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  let cd = Buffer.concat(centrals);
  let eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

describe('Unit / Unzip', () => {
  let tmp, archive;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-unzip-'));
    archive = path.join(tmp, 'fixture.zip');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('extracts stored and deflated entries', async () => {
    let big = 'percy'.repeat(100_000);

    fs.writeFileSync(archive, makeZip([
      { name: 'dir/', mode: 0o40755 },
      { name: 'dir/stored.txt', data: 'stored contents' },
      { name: 'dir/deflated.txt', data: big, deflate: true }
    ]));

    await unzip(archive, { dir: path.join(tmp, 'out') });

    expect(fs.readFileSync(path.join(tmp, 'out/dir/stored.txt'), 'utf8')).toBe('stored contents');
    expect(fs.readFileSync(path.join(tmp, 'out/dir/deflated.txt'), 'utf8')).toBe(big);
  });

  it('creates intermediate directories for nested entries', async () => {
    fs.writeFileSync(archive, makeZip([
      { name: 'a/b/c/file.txt', data: 'nested' }
    ]));

    await unzip(archive, { dir: path.join(tmp, 'out') });

    expect(fs.readFileSync(path.join(tmp, 'out/a/b/c/file.txt'), 'utf8')).toBe('nested');
  });

  it('skips macOS resource fork entries', async () => {
    fs.writeFileSync(archive, makeZip([
      { name: 'file.txt', data: 'real' },
      { name: '__MACOSX/file.txt', data: 'fork' }
    ]));

    await unzip(archive, { dir: path.join(tmp, 'out') });

    expect(fs.existsSync(path.join(tmp, 'out/file.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'out/__MACOSX'))).toBe(false);
  });

  it('rejects entries that would escape the target directory', async () => {
    fs.writeFileSync(archive, makeZip([
      { name: '../evil.txt', data: 'oops' }
    ]));

    // yauzl 3 rejects relative paths at parse time; the unzip module also
    // guards against zip-slip for entries yauzl allows through
    await expectAsync(unzip(archive, { dir: path.join(tmp, 'out') }))
      .toBeRejectedWithError(/invalid relative path|Out of bound path/);

    expect(fs.existsSync(path.join(tmp, 'evil.txt'))).toBe(false);
  });

  it('rejects relative target directories', async () => {
    fs.writeFileSync(archive, makeZip([
      { name: 'file.txt', data: 'contents' }
    ]));

    await expectAsync(unzip(archive, { dir: 'relative/out' }))
      .toBeRejectedWithError('Target directory is expected to be absolute');
  });

  if (process.platform !== 'win32') {
    it('preserves executable file modes', async () => {
      fs.writeFileSync(archive, makeZip([
        { name: 'bin/exec.sh', data: '#!/bin/sh\n', mode: 0o100755 },
        { name: 'bin/plain.txt', data: 'plain', mode: 0o100644 }
      ]));

      await unzip(archive, { dir: path.join(tmp, 'out') });

      expect(fs.statSync(path.join(tmp, 'out/bin/exec.sh')).mode & 0o777).toBe(0o755);
      expect(fs.statSync(path.join(tmp, 'out/bin/plain.txt')).mode & 0o777).toBe(0o644);
    });

    it('restores symlink entries', async () => {
      fs.writeFileSync(archive, makeZip([
        { name: 'target.txt', data: 'linked contents' },
        { name: 'link.txt', data: 'target.txt', mode: 0o120755 }
      ]));

      await unzip(archive, { dir: path.join(tmp, 'out') });

      expect(fs.lstatSync(path.join(tmp, 'out/link.txt')).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(path.join(tmp, 'out/link.txt'))).toBe('target.txt');
      expect(fs.readFileSync(path.join(tmp, 'out/link.txt'), 'utf8')).toBe('linked contents');
    });
  }
});
