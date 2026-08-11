import fs from 'fs';

// Minimal PNG/JPEG dimension reader. `percy upload` only ever accepts png, jpg and
// jpeg files (see ALLOWED_FILE_TYPES in upload.js), so a general purpose image
// parser is more dependency — and more attack surface — than this command needs.
// The previous dependency (`image-size`) is archived upstream and carries
// unfixable infinite-loop advisories in parsers we never wanted in the first
// place (CVE-2025-71329, CVE-2025-71330).

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = Buffer.from('IHDR', 'ascii');

// SOFn markers carry frame dimensions. 0xc4 (DHT), 0xc8 (JPG) and 0xcc (DAC)
// sit in the same range but are not frame headers.
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

// Markers that stand alone — no length-prefixed payload follows them.
const JPEG_STANDALONE_MARKERS = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8
]);

// Reads exactly `length` bytes at `position`, or returns null on a short read.
function readAt(fd, length, position) {
  let buffer = Buffer.alloc(length);
  let bytesRead = fs.readSync(fd, buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
}

// signature (8) + chunk length (4) + chunk type (4) + width (4) + height (4)
function pngSize(fd) {
  let header = readAt(fd, 24, 0);
  if (!header?.subarray(12, 16).equals(IHDR)) return null;

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20)
  };
}

function jpegSize(fd, fileSize) {
  // start just past the SOI marker
  let offset = 2;

  while (offset + 4 <= fileSize) {
    // the loop bound guarantees these four bytes exist, so this cannot short read
    let header = readAt(fd, 4, offset);
    // every marker begins with 0xff — anything else means we've walked out of
    // the segment chain and into entropy-coded data
    if (header[0] !== 0xff) return null;

    let marker = header[1];
    // 0xff may repeat as fill bytes before the marker itself
    if (marker === 0xff) { offset += 1; continue; }
    if (JPEG_STANDALONE_MARKERS.has(marker)) { offset += 2; continue; }
    // SOS begins scan data and EOI ends the image — a frame header should
    // already have been seen by now, so there is nothing left to find
    if (marker === 0xda || marker === 0xd9) return null;

    let length = header.readUInt16BE(2);
    // A segment length always counts its own two length bytes. Anything shorter
    // is malformed, and advancing by it would not move `offset` forward — the
    // exact shape of the infinite loops that made `image-size` unfixable.
    if (length < 2) return null;

    if (JPEG_SOF_MARKERS.has(marker)) {
      // precision (1) + height (2) + width (2)
      let frame = readAt(fd, 5, offset + 4);
      if (!frame) return null;

      return {
        width: frame.readUInt16BE(3),
        height: frame.readUInt16BE(1)
      };
    }

    offset += 2 + length;
  }

  return null;
}

// Returns `{ width, height }` for a PNG or JPEG file, or null when the file is
// neither — including when its extension disagrees with its actual contents.
export function imageSize(absolutePath) {
  let fd = fs.openSync(absolutePath, 'r');

  try {
    let signature = readAt(fd, 8, 0);
    if (!signature) return null;

    if (signature.equals(PNG_SIGNATURE)) return pngSize(fd);
    if (signature[0] === 0xff && signature[1] === 0xd8) {
      return jpegSize(fd, fs.fstatSync(fd).size);
    }

    return null;
  } finally {
    fs.closeSync(fd);
  }
}

export default imageSize;
