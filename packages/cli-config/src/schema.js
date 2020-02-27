import Ajv from 'ajv';

const { assign, entries, freeze } = Object;

// Ajv manages and validates schemas.
const ajv = new Ajv({
  verbose: true,
  allErrors: true,
  schemas: {
    config: getDefaultSchema()
  }
});

// Returns a new default schema.
function getDefaultSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { type: 'integer', default: 2 }
    }
  };
}

// Adds schemas to the config schema's properties. The config schema is removed,
// modified, and replaced after the new schemas are added to clear any compiled
// caches. Existing schemas are removed and replaced as well.
export function addSchema(schemas) {
  let { schema: config } = ajv.getSchema('config');
  ajv.removeSchema('config');

  for (let [$id, schema] of entries(schemas)) {
    if (ajv.getSchema($id)) ajv.removeSchema($id);
    assign(config.properties, { [$id]: { $ref: $id } });
    ajv.addSchema(schema, $id);
  }

  ajv.addSchema(config, 'config');
}

// Resets the schema by removing all schemas and inserting a new default schema.
export function resetSchema() {
  ajv.removeSchema();
  ajv.addSchema(getDefaultSchema(), 'config');
}

// Recursively walks a schema and collects defaults. When no schema is provided,
// the default config schema is used. Returned defaults are frozen.
export function getDefaults(schema) {
  if (!schema || typeof schema.$ref === 'string') {
    // get the schema from ajv
    return getDefaults(ajv.getSchema(schema?.$ref ?? 'config').schema);
  } else if (schema.default != null) {
    // return the frozen default for this schema
    return freeze(schema.default);
  } else if (schema.type === 'object' && schema.properties) {
    // return a frozen object of default properties
    return freeze(
      entries(schema.properties).reduce((acc, [prop, schema]) => {
        let def = getDefaults(schema);
        return def != null ? assign(acc || {}, { [prop]: def }) : acc;
      }, undefined)
    );
  } else {
    return undefined;
  }
}

// Validates config data according to the config schema. When failing, an array
// of errors is returned with formatted messages. Returns undefined when passing.
export function validate(config, scrub) {
  if (!ajv.validate('config', config)) {
    return ajv.errors.map(error => {
      let { dataPath, keyword, params, message, data } = error;
      let pre = dataPath ? `'${dataPath.substr(1)}' ` : '';

      if (keyword === 'required') {
        message = `is missing required property '${params.missingProperty}'`;
      } else if (keyword === 'additionalProperties') {
        pre = pre ? `${pre}has ` : '';
        message = `unknown property '${params.additionalProperty}'`;
        if (scrub) delete data[params.additionalProperty];
      } else if (keyword === 'type') {
        let dataType = Array.isArray(data) ? 'array' : typeof data;
        message = `should be ${a(params.type)}, received ${a(dataType)}`;

        if (scrub) {
          let [key, ...path] = dataPath.substr(1).split('.').reverse();
          delete path.reduceRight((d, k) => d[k], config)[key];
        }
      }

      return `${pre}${message}`;
    });
  }
}

// Adds "a" or "an" to a word for readability.
function a(word) {
  return `${('aeiou').includes(word[0]) ? 'an' : 'a'} ${word}`;
}
