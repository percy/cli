function parseSelection(value, pageCount) {
  if (value == null) return range(1, pageCount);
  if (typeof value === 'number') return [toPageNumber(value)];
  if (Array.isArray(value)) return value.map(toPageNumber);

  if (typeof value !== 'string') {
    throw new Error(`Invalid page selection: expected a number, array or string, got ${typeof value}`);
  }

  let selected = [];

  for (let part of value.split(',')) {
    part = part.trim();
    if (!part) continue;

    let match = /^(\d+)\s*-\s*(\d+)?$/.exec(part);

    if (match) {
      let from = toPageNumber(match[1]);
      let to = match[2] == null ? pageCount : toPageNumber(match[2]);
      if (to < from) throw new Error(`Invalid page range "${part}": end page is before start page`);
      selected.push(...range(from, to));
    } else if (/^\d+$/.test(part)) {
      selected.push(toPageNumber(part));
    } else {
      throw new Error(`Invalid page selection "${part}": expected a page number or a range like "2-5"`);
    }
  }

  return selected;
}

function toPageNumber(value) {
  let n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid page number "${value}": page numbers are 1-based integers`);
  }
  return n;
}

function range(from, to) {
  let out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

export function resolvePages({ pages, excludePages } = {}, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`Invalid page count: ${pageCount}`);
  }

  let selected = parseSelection(pages, pageCount);
  let excluded = new Set(excludePages == null ? [] : parseSelection(excludePages, pageCount));

  let outOfRange = [...new Set(selected.filter(p => p > pageCount))];
  if (outOfRange.length) {
    throw new Error(
      `Requested page${outOfRange.length > 1 ? 's' : ''} ${outOfRange.join(', ')} ` +
      `but the document has only ${pageCount} page${pageCount > 1 ? 's' : ''}`
    );
  }

  let resolved = [...new Set(selected)]
    .filter(p => !excluded.has(p))
    .sort((a, b) => a - b);

  if (!resolved.length) {
    throw new Error('No pages left to snapshot after applying `pages` and `excludePages`');
  }

  return resolved;
}

export { parseSelection as _parseSelection };
