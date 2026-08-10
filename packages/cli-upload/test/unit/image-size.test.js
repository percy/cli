import fs from 'fs';
import os from 'os';
import path from 'path';
import { imageSize } from '../../src/image-size.js';
import {
  PNG_PIXEL,
  PNG_120X80,
  JPEG_PIXEL,
  JPEG_200X150,
  GIF_PIXEL,
  icnsZeroLengthEntry,
  jpegZeroLengthSegment
} from '../fixtures.js';

describe('unit / image-size', () => {
  let dirname, index = 0;

  // these tests read real files — `imageSize` opens a descriptor and reads at
  // offsets, which is the behaviour worth exercising against a real filesystem
  beforeAll(() => {
    dirname = fs.mkdtempSync(path.join(os.tmpdir(), 'percy-image-size-'));
  });

  afterAll(() => {
    fs.rmSync(dirname, { recursive: true, force: true });
  });

  let write = contents => {
    let filename = path.join(dirname, `fixture-${index++}`);
    fs.writeFileSync(filename, contents);
    return filename;
  };

  it('reads PNG dimensions', () => {
    expect(imageSize(write(PNG_PIXEL))).toEqual({ width: 1, height: 1 });
    expect(imageSize(write(PNG_120X80))).toEqual({ width: 120, height: 80 });
  });

  it('reads JPEG dimensions', () => {
    expect(imageSize(write(JPEG_PIXEL))).toEqual({ width: 1, height: 1 });
    expect(imageSize(write(JPEG_200X150))).toEqual({ width: 200, height: 150 });
  });

  it('returns null for other image formats', () => {
    expect(imageSize(write(GIF_PIXEL))).toBeNull();
  });

  it('returns null for files that are not images', () => {
    expect(imageSize(write('not an image'))).toBeNull();
    expect(imageSize(write(Buffer.alloc(0)))).toBeNull();
  });

  it('returns null for a truncated PNG', () => {
    expect(imageSize(write(PNG_PIXEL.subarray(0, 16)))).toBeNull();
  });

  it('returns null for a PNG whose first chunk is not IHDR', () => {
    let png = Buffer.from(PNG_PIXEL);
    png.write('IDAT', 12, 'ascii');
    expect(imageSize(write(png))).toBeNull();
  });

  it('returns null for a JPEG with no frame header', () => {
    // truncate to the SOI marker and the start of APP0
    expect(imageSize(write(JPEG_PIXEL.subarray(0, 4)))).toBeNull();
  });

  // CVE-2025-71330 / CVE-2025-71329 — the advisories that made `image-size`
  // unusable were all the same shape: a zero-valued length field left the read
  // offset unchanged, so the parser looped forever and wedged the event loop.
  it('terminates on an ICNS buffer with a zero-length entry', () => {
    // named `.png` because `percy upload` filters on extension, which is how
    // this buffer reached the ICNS parser in the first place
    let filename = path.join(dirname, 'crafted.png');
    fs.writeFileSync(filename, icnsZeroLengthEntry());

    expect(imageSize(filename)).toBeNull();
  });

  it('terminates on a JPEG segment with a zero length', () => {
    expect(imageSize(write(jpegZeroLengthSegment()))).toBeNull();
  });

  it('terminates on a JPEG of nothing but 0xff fill bytes', () => {
    let buffer = Buffer.alloc(4096, 0xff);
    buffer.writeUInt16BE(0xffd8, 0);

    expect(imageSize(write(buffer))).toBeNull();
  });
});
