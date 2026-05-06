import {
  PNG_MAGIC_BYTES,
  parsePngDimensions,
  isPortrait,
  isLandscape
} from '../../src/png-dimensions.js';

// Minimal PNG-header fixture builder.
// Real PNG structure is: 8-byte signature + 4-byte IHDR chunk length + 4-byte "IHDR"
// + 4-byte width (big-endian) + 4-byte height (big-endian) + … (more bytes we ignore).
// parsePngDimensions only needs the first 24 bytes.
function makePngHeader(width, height) {
  const buf = Buffer.alloc(24);
  // 0..7 signature
  PNG_MAGIC_BYTES.copy(buf, 0);
  // 8..11 IHDR length (0x0000000D = 13)
  buf.writeUInt32BE(13, 8);
  // 12..15 'IHDR'
  Buffer.from('IHDR', 'ascii').copy(buf, 12);
  // 16..19 width, 20..23 height (big-endian uint32)
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe('Unit / png-dimensions', () => {
  describe('PNG_MAGIC_BYTES', () => {
    it('is the standard 8-byte PNG signature', () => {
      expect(PNG_MAGIC_BYTES.length).toBe(8);
      expect(Array.from(PNG_MAGIC_BYTES)).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    });
  });

  describe('parsePngDimensions', () => {
    it('returns (width, height) for iPhone 14 portrait (1170 × 2532)', () => {
      const png = makePngHeader(1170, 2532);
      expect(parsePngDimensions(png)).toEqual({ width: 1170, height: 2532 });
    });

    it('returns (width, height) for iPhone 14 landscape (2532 × 1170)', () => {
      const png = makePngHeader(2532, 1170);
      expect(parsePngDimensions(png)).toEqual({ width: 2532, height: 1170 });
    });

    it('parses dimensions > 65535', () => {
      // PNG spec allows up to 2^31 - 1
      const png = makePngHeader(100000, 200000);
      expect(parsePngDimensions(png)).toEqual({ width: 100000, height: 200000 });
    });

    it('throws "invalid-png" when buffer is shorter than 24 bytes', () => {
      const truncated = Buffer.alloc(16);
      expect(() => parsePngDimensions(truncated)).toThrowError(/invalid-png/);
    });

    it('throws "invalid-png" when signature does not match', () => {
      const notPng = Buffer.alloc(24);
      // Leave first 8 bytes as zeros — not PNG signature
      notPng.writeUInt32BE(1170, 16);
      notPng.writeUInt32BE(2532, 20);
      expect(() => parsePngDimensions(notPng)).toThrowError(/invalid-png/);
    });

    it('throws "invalid-png-dimensions" when width is 0', () => {
      const png = makePngHeader(0, 2532);
      expect(() => parsePngDimensions(png)).toThrowError(/invalid-png-dimensions/);
    });

    it('throws "invalid-png-dimensions" when height is 0', () => {
      const png = makePngHeader(1170, 0);
      expect(() => parsePngDimensions(png)).toThrowError(/invalid-png-dimensions/);
    });

    it('throws on a non-Buffer argument', () => {
      expect(() => parsePngDimensions(null)).toThrow();
      expect(() => parsePngDimensions('not a buffer')).toThrow();
      expect(() => parsePngDimensions(undefined)).toThrow();
    });
  });

  describe('isPortrait / isLandscape', () => {
    // threshold defaults to 1.25 per plan's landscape-tiering decision

    it('iPhone portrait (1170 × 2532, ratio 2.16) is portrait', () => {
      expect(isPortrait({ width: 1170, height: 2532 })).toBe(true);
      expect(isLandscape({ width: 1170, height: 2532 })).toBe(false);
    });

    it('iPhone landscape (2532 × 1170, ratio 0.46) is landscape', () => {
      expect(isPortrait({ width: 2532, height: 1170 })).toBe(false);
      expect(isLandscape({ width: 2532, height: 1170 })).toBe(true);
    });

    it('iPad Pro 12.9" portrait (2048 × 2732, ratio 1.334) is portrait at default threshold 1.25', () => {
      expect(isPortrait({ width: 2048, height: 2732 })).toBe(true);
      expect(isLandscape({ width: 2048, height: 2732 })).toBe(false);
    });

    it('iPad Pro 12.9" landscape (2732 × 2048) is landscape at default threshold 1.25', () => {
      expect(isPortrait({ width: 2732, height: 2048 })).toBe(false);
      expect(isLandscape({ width: 2732, height: 2048 })).toBe(true);
    });

    it('square (500 × 500) is NEITHER portrait nor landscape', () => {
      expect(isPortrait({ width: 500, height: 500 })).toBe(false);
      expect(isLandscape({ width: 500, height: 500 })).toBe(false);
    });

    it('near-square (500 × 550, ratio 1.1 < 1.25) is ambiguous (neither)', () => {
      expect(isPortrait({ width: 500, height: 550 })).toBe(false);
      expect(isLandscape({ width: 500, height: 550 })).toBe(false);
    });

    it('accepts an override threshold', () => {
      // With threshold 1.1, near-square becomes portrait
      expect(isPortrait({ width: 500, height: 550 }, 1.1)).toBe(false); // 550 > 500*1.1 = 550 (not strict >)
      expect(isPortrait({ width: 500, height: 551 }, 1.1)).toBe(true);
      expect(isLandscape({ width: 551, height: 500 }, 1.1)).toBe(true);
    });

    it('iPad Split View 1/3-width portrait (1024 × 2732, ratio 2.67) is portrait', () => {
      expect(isPortrait({ width: 1024, height: 2732 })).toBe(true);
    });

    it('malformed input (missing width/height) throws or returns false', () => {
      // Choosing false over throw — matches caller-ergonomic invariant
      expect(isPortrait({})).toBe(false);
      expect(isLandscape({})).toBe(false);
      expect(isPortrait({ width: 100 })).toBe(false);
      expect(isPortrait({ height: 100 })).toBe(false);
    });
  });
});
