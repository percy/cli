import merge from './merge.js';
import { getSchema } from '../validate.js';

// Edge case camelizations
const CAMELCASE_MAP = new Map([
  ['css', 'CSS'],
  ['javascript', 'JavaScript']
]);

// Converts kebab-cased and snake_cased strings to camelCase.
const KEBAB_SNAKE_REG = /[-_]([^-_]+)/g;

export function camelcase(str) {
  if (typeof str !== 'string') return str;

  return str.replace(KEBAB_SNAKE_REG, (match, word) => (
    CAMELCASE_MAP.get(word) || (word[0].toUpperCase() + word.slice(1))
  ));
}

// Coverts camelCased and snake_cased strings to kebab-case.
const CAMEL_SNAKE_REG = /([a-z])([A-Z]+)|_([^_]+)/g;

export function kebabcase(str) {
  if (typeof str !== 'string') return str;

  return Array.from(CAMELCASE_MAP)
    .reduce((str, [word, camel]) => (
      str.replace(camel, `-${word}`)
    ), str)
    .replace(CAMEL_SNAKE_REG, (match, p, n, w) => (
      `${p || ''}-${(n || w).toLowerCase()}`
    ));
}

// Removes undefined empty values and renames kebab-case properties to camelCase. Optionally
// allows deep merging with options.overrides, converting keys to kebab-case with options.kebab,
// and normalizing against a schema with options.schema.
export function normalize(object, options) {
  if (typeof options === 'string') options = { schema: options };
  let keycase = options?.kebab ? kebabcase : camelcase;

  return merge([object, options?.overrides], (path, value) => {
    let schemas = getSchema(options?.schema, path.map(camelcase));
    let skip = schemas.shift()?.normalize === false || options?.skip?.(path, value);

    // skip normalizing paths of class instances
    if (!skip && typeof value === 'object' && value?.constructor) {
      skip = Object.getPrototypeOf(value) !== Object.prototype;
    }

    path = path.map((k, i) => {
      if (skip) return k;
      skip ||= schemas[i]?.normalize === false;
      return keycase(k);
    });

    return [path];
  });
}

export default normalize;
