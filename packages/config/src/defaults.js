import merge from 'deepmerge';
import { getSchema } from './validate';

const { assign, entries, freeze } = Object;

// Recursively walks a schema and collects defaults. When no schema is provided,
// the default config schema is used. Returned defaults are frozen.
function getDefaultFromSchema(schema) {
  if (!schema || typeof schema.$ref === 'string') {
    // get the schema from ajv
    return getDefaultFromSchema(getSchema(schema?.$ref ?? 'config'));
  } else if (schema.default != null) {
    // return the frozen default for this schema
    return freeze(schema.default);
  } else if (schema.type === 'object' && schema.properties) {
    // return a frozen object of default properties
    return freeze(
      entries(schema.properties).reduce((acc, [prop, schema]) => {
        let def = getDefaultFromSchema(schema);
        return def != null ? assign(acc || {}, { [prop]: def }) : acc;
      }, undefined)
    );
  } else {
    return undefined;
  }
}

export default function getDefaults(overrides = {}) {
  return merge.all([getDefaultFromSchema(), overrides], {
    // overwrite default arrays, do not merge
    arrayMerge: (_, arr) => arr
  });
}
