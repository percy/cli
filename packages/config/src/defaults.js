import { merge } from './utils/index.js';
import { getSchema } from './validate.js';

const { isArray } = Array;
const { assign, entries } = Object;

// Recursively walks a schema and collects defaults. When no schema is provided,
// the default config schema is used.
function getDefaultsFromSchema(schema) {
  if (!schema || typeof schema.$ref === 'string') {
    // get the schema from ajv
    return getDefaultsFromSchema(getSchema(schema?.$ref ?? '/config'));
  } else if (schema.default != null) {
    // return the default for this schema
    return schema.default;
  } else if (schema.type === 'object' && schema.properties) {
    // return an object of default properties
    return entries(schema.properties).reduce((acc, [prop, schema]) => {
      if(!isSafeKey(prop)){
        return acc;
      }
      let def = getDefaultsFromSchema(schema);
      return def != null ? assign(acc || {}, { [prop]: def }) : acc;
    }, undefined);
  } else {
    return undefined;
  }
}

// Utility function to prevent prototype pollution
function isSafeKey(key) {
  const unsafeKeys = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
                      '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'];
  return !unsafeKeys.includes(key);
}


function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object' || isArray(obj)) {
    return obj; 
  }

  const sanitized = {};
  for (const key in obj) {
    if (isSafeKey(key)) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
  }

  return sanitized;
}

export function getDefaults(overrides = {}) {
  const sanitizedOverrides = sanitizeObject(overrides);
  return merge([getDefaultsFromSchema(), sanitizedOverrides], (path, prev, next) => {
    // override default array instead of merging
    return isArray(next) && [path, next];
  });
}

export default getDefaults;
