import { merge } from './utils';

// Edge case camelizations
const CAMELCASE_MAP = new Map([
  ['css', 'CSS'],
  ['javascript', 'JavaScript']
]);

// Do not change casing of nested options
const SKIP_CASING_OPTIONS = [
  'request-headers',
  'requestHeaders',
  'cookies',
  'rewrites'
];

// Converts kebab-cased and snake_cased strings to camelCase.
const KEBAB_SNAKE_REG = /[-_]([^-_]+)/g;

function camelcase(str) {
  return str.replace(KEBAB_SNAKE_REG, (match, word) => (
    CAMELCASE_MAP.get(word) || (word[0].toUpperCase() + word.slice(1))
  ));
}

// Coverts camelCased and snake_cased strings to kebab-case.
const CAMEL_SNAKE_REG = /([a-z])([A-Z]+)|_([^_]+)/g;

function kebabcase(str) {
  return Array.from(CAMELCASE_MAP)
    .reduce((str, [word, camel]) => (
      str.replace(camel, `-${word}`)
    ), str)
    .replace(CAMEL_SNAKE_REG, (match, p, n, w) => (
      `${p || ''}-${(n || w).toLowerCase()}`
    ));
}

// Recursively reduces config objects and arrays to remove undefined and empty values and rename
// kebab-case properties to camelCase. Optionally allows deep merging of a second overrides
// argument, and converting keys to kebab-case with a third options.kebab argument.
export default function normalize(object, options) {
  let keycase = options?.kebab ? kebabcase : camelcase;

  return merge([object, options?.overrides], (path, prev, next) => {
    let skip = false;

    path = path.map(k => {
      if (!skip && typeof k === 'string') k = keycase(k);
      skip = SKIP_CASING_OPTIONS.includes(k);
      return k;
    });

    return [path];
  });
}
