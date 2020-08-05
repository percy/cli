// recursively reduces config objects and arrays to remove undefined and empty
// values and rename kebab-case properties to camelCase.
export default function normalize(subject) {
  if (typeof subject === 'object') {
    let isArray = Array.isArray(subject);

    return Object.entries(subject)
      .reduce((result, [key, value]) => {
        value = normalize(value);

        if (typeof value !== 'undefined') {
          return isArray
            ? (result || []).concat(value)
            : Object.assign(result || {}, { [camelize(key)]: value });
        } else {
          return result;
        }
      }, undefined);
  } else {
    return subject;
  }
}

// Edge case camelizations
const CAMELIZE_MAP = {
  css: 'CSS',
  javascript: 'JavaScript'
};

// Converts a kebab-cased string to camelCase.
function camelize(s) {
  return s.replace(/-([^-]+)/g, (_, w) => (
    CAMELIZE_MAP[w] || (w[0].toUpperCase() + w.slice(1))
  ));
}
