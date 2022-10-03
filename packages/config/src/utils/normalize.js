import merge from './merge.js';
import { getSchema } from '../validate.js';

// Edge case camelizations
const CAMELCASE_MAP = new Map([
  ['css', 'CSS'],
  ['javascript', 'JavaScript']
]);

// Regular expression that matches words from boundaries or consecutive casing
const WORD_REG = /[a-z]{2,}|[A-Z]{2,}|[0-9]{2,}|[^-_\s]+?(?=[A-Z0-9-_\s]|$)/g;

// Converts kebab-cased and snake_cased strings to camelCase.
export function camelcase(str) {
  if (typeof str !== 'string') return str;

  return str.match(WORD_REG).reduce((s, w, i) => s + (i ? (
    CAMELCASE_MAP.get(w.toLowerCase()) || (
      w[0].toUpperCase() + w.slice(1).toLowerCase())
  ) : w.toLowerCase()), '');
}

// Coverts camelCased and snake_cased strings to kebab-case.
export function kebabcase(str) {
  if (typeof str !== 'string') return str;

  return Array.from(CAMELCASE_MAP)
    .reduce((str, [word, camel]) => str.replace(camel, `-${word}`), str)
    .match(WORD_REG).join('-').toLowerCase();
}

// Coverts kebab-case and camelCased strings to snake_case.
export function snakecase(str) {
  if (typeof str !== 'string') return str;

  return Array.from(CAMELCASE_MAP)
    .reduce((str, [word, camel]) => str.replace(camel, `_${word}`), str)
    .match(WORD_REG).join('_').toLowerCase();
}

// Removes undefined empty values and renames kebab-case properties to camelCase. Optionally
// allows deep merging with options.overrides, converting keys to kebab-case with options.kebab,
// and normalizing against a schema with options.schema.
export function normalize(object, options) {
  if (typeof options === 'string') options = { schema: options };
  let keycase = options?.kebab ? kebabcase : options?.snake ? snakecase : camelcase;

  return merge([object, options?.overrides], (path, value) => {
    let schemas = getSchema(options?.schema, path.map(camelcase));
    let skip = schemas.shift()?.normalize === false;
    let mapped = [];

    // skip normalizing paths of class instances
    if (!skip && typeof value === 'object' && value?.constructor) {
      skip = Object.getPrototypeOf(value) !== Object.prototype;
    }

    for (let [i, k] of path.entries()) {
      skip ||= options?.skip?.(mapped.concat(k));
      mapped.push(skip ? k : keycase(k));
      skip ||= schemas[i]?.normalize === false;
    }

    return [mapped];
  });
}

export default normalize;
