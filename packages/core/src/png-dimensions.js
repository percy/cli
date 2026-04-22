// PNG header inspector — extracts (width, height) via hand-parsed IHDR, plus
// orientation helpers. No new dependency.
//
// Serves:
//   - /percy/comparison/upload signature check (existing consumer via api.js)
//   - /percy/maestro-screenshot iOS path: scale factor (pngWidth / wda window width)
//     and aspect-ratio-based landscape tiering fallback.
//
// Spec: libpng §11.2.2. The 8-byte signature is followed by the IHDR chunk:
//   bytes 8..11 — chunk length (0x0D = 13)
//   bytes 12..15 — 'IHDR'
//   bytes 16..19 — width (big-endian uint32)
//   bytes 20..23 — height (big-endian uint32)
// We only need the first 24 bytes.

export const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Default landscape/portrait threshold. iPad-portrait aspect is ~1.33; 1.25 gives
// a comfortable margin for iPad while still rejecting near-square ambiguous crops.
// The plan's Unit A1 Probe 6 is to empirically confirm this constant on BS iOS
// hosts; when that runs, callers can pass an override.
export const DEFAULT_ORIENTATION_THRESHOLD = 1.25;

// Extract width and height from a PNG buffer. Throws on invalid input.
export function parsePngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('invalid-png: expected Buffer');
  }
  if (buffer.length < 24) {
    throw new Error('invalid-png: truncated (< 24 bytes)');
  }
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)) {
    throw new Error('invalid-png: signature mismatch');
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (width === 0 || height === 0) {
    throw new Error('invalid-png-dimensions: width and height must be > 0');
  }

  return { width, height };
}

// True when height > width * threshold. False otherwise (including near-square).
export function isPortrait(dims, threshold = DEFAULT_ORIENTATION_THRESHOLD) {
  if (!dims || typeof dims.width !== 'number' || typeof dims.height !== 'number') return false;
  return dims.height > dims.width * threshold;
}

// True when width > height * threshold. False otherwise (including near-square).
export function isLandscape(dims, threshold = DEFAULT_ORIENTATION_THRESHOLD) {
  if (!dims || typeof dims.width !== 'number' || typeof dims.height !== 'number') return false;
  return dims.width > dims.height * threshold;
}
