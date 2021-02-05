const { isArray } = Array;
const { entries, assign } = Object;

// Edge case camelizations
const CAMELCASE_MAP = new Map([
  ['css', 'CSS'],
  ['javascript', 'JavaScript']
]);

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

// Merges source values into the target object unless empty. When `options.replaceArrays` is truthy,
// target arrays are replaced by their source arrays rather than concatenated together.
export function merge(target, source, options) {
  let isSourceArray = isArray(source);
  if (options?.replaceArrays && isSourceArray) return source;
  if (typeof source !== 'object') return source != null ? source : target;
  let convertcase = options?.kebab ? kebabcase : camelcase;

  return entries(source).reduce((result, [key, value]) => {
    value = merge(result?.[key], value, options);

    return value == null ? result
      : isSourceArray ? (result || []).concat(value)
        : assign(result || {}, { [convertcase(key)]: value });
  }, target);
}

// Recursively reduces config objects and arrays to remove undefined and empty values and rename
// kebab-case properties to camelCase. Optionally allows deep merging of a second overrides
// argument, and converting keys to kebab-case with a third options.kebab argument.
export default function normalize(object, options) {
  object = merge(undefined, object, options);
  return options?.overrides
    ? merge(object, options.overrides, options)
    : object;
}
