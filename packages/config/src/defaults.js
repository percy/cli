import { merge } from './normalize';
import { getSchema } from './validate';

const { assign, entries } = Object;

// Recursively walks a schema and collects defaults. When no schema is provided,
// the default config schema is used.
function getDefaultFromSchema(schema) {
  if (!schema || typeof schema.$ref === 'string') {
    // get the schema from ajv
    return getDefaultFromSchema(getSchema(schema?.$ref ?? 'config'));
  } else if (schema.default != null) {
    // return the default for this schema
    return schema.default;
  } else if (schema.type === 'object' && schema.properties) {
    // return an object of default properties
    return entries(schema.properties).reduce((acc, [prop, schema]) => {
      let def = getDefaultFromSchema(schema);
      return def != null ? assign(acc || {}, { [prop]: def }) : acc;
    }, undefined);
  } else {
    return undefined;
  }
}

export default function getDefaults(overrides = {}) {
  return merge(getDefaultFromSchema(), overrides, {
    replaceArrays: true
  });
}
