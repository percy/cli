import { setupTest } from '../helpers/index.js';
import { parsePngDimensions } from '../../src/maestro-screenshot.js';

describe('Unit / maestro-screenshot', () => {
  beforeEach(async () => {
    await setupTest();
  });

  describe('parsePngDimensions', () => {
    // Mirrors the minimal 24-byte PNG header builder used by the api.test.js
    // relay specs: signature + IHDR length/type + big-endian width/height.
    function makePngHeader(width, height) {
      const buf = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buf, 0);
      buf.writeUInt32BE(13, 8);
      Buffer.from('IHDR', 'ascii').copy(buf, 12);
      buf.writeUInt32BE(width, 16);
      buf.writeUInt32BE(height, 20);
      return buf;
    }

    it('reads width/height from a valid PNG IHDR', () => {
      expect(parsePngDimensions(makePngHeader(1080, 2400))).toEqual({ width: 1080, height: 2400 });
    });

    it('returns null for a non-PNG signature', () => {
      expect(parsePngDimensions(Buffer.alloc(24, 0))).toBeNull();
    });

    it('returns null for a truncated buffer (< 24 bytes)', () => {
      expect(parsePngDimensions(makePngHeader(10, 10).subarray(0, 23))).toBeNull();
    });

    it('returns null when IHDR dimensions are zero', () => {
      expect(parsePngDimensions(makePngHeader(0, 0))).toBeNull();
    });

    it('returns null for null or empty input', () => {
      expect(parsePngDimensions(null)).toBeNull();
      expect(parsePngDimensions(Buffer.alloc(0))).toBeNull();
    });
  });
});
