// Real image bytes, kept as buffers rather than strings — the PNG signature
// starts with 0x89, which does not survive a round trip through UTF-8.

const b64 = str => Buffer.from(str, 'base64');

// 1x1 red PNG
export const PNG_PIXEL = b64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ' +
  '/pLvAAAAAElFTkSuQmCC'
);

// 120x80 red PNG
export const PNG_120X80 = b64(
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAIAAABd+SbeAAAA4klEQVR4nO3OQQ0AIAADsfk3' +
  'DS7o40gqoDvb94AfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4' +
  'QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E' +
  '+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQf' +
  'RPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRPhBhB9E+EGEH0T4QYQfRFwNVlys/6lZ' +
  'IQAAAABJRU5ErkJggg=='
);

// 1x1 red JPEG
export const JPEG_PIXEL = b64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9' +
  'PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC' +
  'Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR' +
  'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
  'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk' +
  '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryz7w/9k='
);

// 200x150 red JPEG — its frame header sits past several kilobyte-scale
// quantization and Huffman tables, so reading it exercises segment walking
// rather than a fixed header offset.
export const JPEG_200X150 = b64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9' +
  'PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC' +
  'Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR' +
  'CACWAMgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
  'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk' +
  '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryz7wKKKKACiiigAooooAKKKKACii' +
  'igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA' +
  'KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii' +
  'igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA' +
  'KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii' +
  'igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA' +
  'KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii' +
  'igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA' +
  'KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii' +
  'igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9k='
);

// A GIF — accepted by neither the extension filter nor the size reader.
export const GIF_PIXEL = b64('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');

// An ICNS buffer with valid magic bytes and a zero-valued entry length.
// This is the CVE-2025-71330 proof of concept: the archived `image-size`
// package looped forever on it because a zero-length entry never advanced the
// read offset. `percy upload` filters by extension, not magic bytes, so a file
// named `.png` reached that parser.
export function icnsZeroLengthEntry() {
  let buffer = Buffer.alloc(64);
  buffer.write('icns', 0, 'ascii');
  buffer.writeUInt32BE(64, 4); // file length
  buffer.write('ic09', 8, 'ascii'); // first entry type
  buffer.writeUInt32BE(0, 12); // first entry length
  return buffer;
}

// A JPEG whose first segment declares a length of zero. Advancing by a
// self-inclusive length below 2 would leave the read offset stationary.
export function jpegZeroLengthSegment() {
  let buffer = Buffer.alloc(32);
  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffe0, 2); // APP0
  buffer.writeUInt16BE(0, 4); // segment length
  return buffer;
}

// A JPEG whose first segment length lands the walk on bytes that do not begin a
// marker — i.e. off the segment chain and into data.
export function jpegWalksIntoData() {
  let buffer = Buffer.alloc(32);
  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffe0, 2); // APP0
  buffer.writeUInt16BE(4, 4); // length 4 ⇒ next marker expected at offset 8
  // offset 8 onward is left zeroed, so no 0xff marker prefix is found
  return buffer;
}

// A JPEG carrying a standalone marker (RST0, no length payload) ahead of the
// frame header. Mis-skipping it would desynchronise the walk.
export function jpegStandaloneMarkerBeforeFrame(width, height) {
  // A SOF0 declaring one component is 11 bytes: length (2) + precision (1) +
  // dimensions (4) + component count (1) + one component spec (3). The segment
  // starts at offset 6, so the buffer has to reach offset 17 for the length it
  // declares to be satisfiable — a parser that checks the declared length
  // against the bytes actually present rejects anything shorter.
  let buffer = Buffer.alloc(17);
  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffd0, 2); // RST0 — standalone
  buffer.writeUInt16BE(0xffc0, 4); // SOF0
  buffer.writeUInt16BE(11, 6); // segment length
  buffer.writeUInt8(8, 8); // sample precision
  buffer.writeUInt16BE(height, 9);
  buffer.writeUInt16BE(width, 11);
  buffer.writeUInt8(1, 13); // component count
  buffer.writeUInt8(1, 14); // component id
  buffer.writeUInt8(0x11, 15); // sampling factors
  buffer.writeUInt8(0, 16); // quantization table selector
  return buffer;
}

// A JPEG that reaches the start of scan without ever declaring a frame.
export function jpegScanWithoutFrame() {
  let buffer = Buffer.alloc(32);
  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffda, 2); // SOS
  buffer.writeUInt16BE(12, 4); // segment length
  return buffer;
}

// A JPEG that reaches end of image without ever declaring a frame.
export function jpegEndsWithoutFrame() {
  let buffer = Buffer.alloc(32);
  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffd9, 2); // EOI
  return buffer;
}

// A JPEG that announces a frame header and then ends before it. Must stay at
// least 8 bytes long, or it is rejected at the signature read and never reaches
// the segment walk this is meant to exercise.
export function jpegTruncatedFrameHeader() {
  let buffer = Buffer.alloc(8);
  buffer.writeUInt16BE(0xffd8, 0); // SOI
  buffer.writeUInt16BE(0xffc0, 2); // SOF0
  buffer.writeUInt16BE(11, 4); // length claims a payload the file does not have
  return buffer;
}
