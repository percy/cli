import fs from 'fs';
// the `sync.js` entrypoint pulls in only the buffer parsers — none of the http
// or stream machinery, and so none of `needle`. Extension included because the
// package publishes no `exports` map, and ESM will not resolve it without one.
import probeSync from 'probe-image-size/sync.js';

// `percy upload` only ever accepts png, jpg and jpeg files (see ALLOWED_FILE_TYPES
// in upload.js), so anything else is rejected here even though the parser can read
// it. The previous dependency (`image-size`) is archived upstream and carries
// unfixable infinite-loop advisories (CVE-2025-71329, CVE-2025-71330) in parsers
// this command never wanted. `probe-image-size` has no ICNS, JXL or HEIF parser at
// all, and its ISOBMFF reader rejects a box smaller than its own header rather than
// advancing by it — the shape of every one of those advisories.
const SUPPORTED_TYPES = new Set(['png', 'jpg']);

// A JPEG frame header sits behind however much metadata the encoder wrote, so the
// whole header cannot be read at a fixed offset. This is the limit `image-size`
// applied for the same reason, kept so that files it could read stay readable.
const MAX_HEADER_BYTES = 512 * 1024;

// Reads the leading bytes of a file without pulling a multi-megabyte image into
// memory just to read its dimensions.
function readHeader(absolutePath) {
  let fd = fs.openSync(absolutePath, 'r');

  try {
    let length = Math.min(fs.fstatSync(fd).size, MAX_HEADER_BYTES);
    let buffer = Buffer.alloc(length);
    // trailing bytes are only unwritten if the file shrank mid-read, but slicing
    // to the actual count is correct either way and keeps this branchless
    let bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

// Returns `{ width, height }` for a PNG or JPEG file, or null when the file is
// neither — including when its extension disagrees with its actual contents.
export function imageSize(absolutePath) {
  let result = probeSync(readHeader(absolutePath));
  if (!result || !SUPPORTED_TYPES.has(result.type)) return null;
  return { width: result.width, height: result.height };
}

export default imageSize;
