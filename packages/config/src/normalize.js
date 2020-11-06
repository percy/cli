const { isArray } = Array;
const { entries, assign } = Object;

// Edge case camelizations
const CAMELIZE_MAP = {
  css: 'CSS',
  javascript: 'JavaScript'
};

// Converts a kebab-cased string to camelCase.
function camelize(str) {
  return str.replace(/-([^-]+)/g, (_, w) => (
    CAMELIZE_MAP[w] || (w[0].toUpperCase() + w.slice(1))
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
