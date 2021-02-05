const { isArray } = Array;
const { entries, assign } = Object;

// Edge case camelizations
const CAMELIZE_MAP = {
  css: 'CSS',
  javascript: 'JavaScript'
};

// Converts kebab-cased and snake_cased strings to camelCase.
const KEBAB_SNAKE_REG = /[-_]([^-_]+)/g;

function camelize(str) {
  return str.replace(KEBAB_SNAKE_REG, (match, word) => (
    CAMELIZE_MAP[word] || (word[0].toUpperCase() + word.slice(1))
  ));
}

// Merges source values into the target object unless empty. When `options.replaceArrays` is truthy,
// target arrays are replaced by their source arrays rather than concatenated together.
export function merge(target, source, options) {
  let isSourceArray = isArray(source);
  if (options?.replaceArrays && isSourceArray) return source;
  if (typeof source !== 'object') return source != null ? source : target;

  return entries(source).reduce((result, [key, value]) => {
    value = merge(result?.[key], value, options);

    return value == null ? result
      : isSourceArray ? (result || []).concat(value)
        : assign(result || {}, { [camelize(key)]: value });
  }, target);
}

// Recursively reduces config objects and arrays to remove undefined and empty values and rename
// kebab-case properties to camelCase. Optionally allows deep merging of override values
export default function normalize(object, overrides) {
  return merge(merge(undefined, object), overrides);
}
