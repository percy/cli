// Page selection for PDF snapshots.
//
// Deliberately NOT a port of percy-pdf's page filtering. That implementation
// assigned its per-page `execute` script inside a `forEach` over every
// previously-pushed snapshot, so all snapshots ended up with the last page's
// script and any gap in the page list silently mislabelled every subsequent
// page. Selecting pages up front and rasterizing each one directly makes that
// class of bug unrepresentable.

// Accepts:
//   undefined / null  -> every page
//   number            -> 3
//   number[]          -> [1, 2, 5]
//   string            -> "1-5", "1,3,8", "1-3,7,9-11", "2-" (2 to end)
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
      // an open-ended range ("5-") runs to the last page
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

// Resolves `pages` / `excludePages` against a document's real page count.
// Returns a sorted, de-duplicated, in-range list of page numbers.
export function resolvePages({ pages, excludePages } = {}, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`Invalid page count: ${pageCount}`);
  }

  let selected = parseSelection(pages, pageCount);
  let excluded = new Set(excludePages == null ? [] : parseSelection(excludePages, pageCount));

  // Out-of-range requests are a caller mistake worth surfacing, not silently
  // dropping -- "why is page 12 missing" is much harder to debug after the fact.
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
