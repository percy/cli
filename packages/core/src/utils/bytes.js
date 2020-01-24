// Converts a raw byte integer into a human readable string.
export default function readableBytes(bytes) {
  let units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let thresh = 1024;
  let u = -1;

  if (Math.abs(bytes) < thresh) {
    return `${bytes}B`;
  }

  while (Math.abs(bytes) >= thresh && u < units.length - 1) {
    bytes /= thresh;
    ++u;
  }

  return `${bytes.toFixed(1)}${units[u]}`;
}
