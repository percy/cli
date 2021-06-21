import Ajv from 'ajv';
const { assign, entries } = Object;

// Ajv manages and validates schemas.
const ajv = new Ajv({
  verbose: true,
  allErrors: true,
  strict: false,
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

// Gets the schema object from the AJV schema.
export function getSchema(name) {
  return ajv.getSchema(name).schema;
}

// Adds schemas to the config schema's properties. The config schema is removed,
// modified, and replaced after the new schemas are added to clear any compiled
// caches. Existing schemas are removed and replaced as well.
export function addSchema(schemas) {
  let config = getSchema('config');
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

// Validates config data according to the config schema and logs warnings to the
// console. Optionallly scrubs invalid values from the provided config. Returns
// true when the validation success, false otherwise.
export default function validate(config) {
  let result = ajv.validate('config', config);
  let errors = [];

  if (!result) {
    for (let error of ajv.errors) {
      let { instancePath, keyword, params, message, parentSchema, data } = error;
      let path = instancePath ? instancePath.substr(1).split('/') : [];

      if (parentSchema.errors?.[keyword]) {
        let custom = parentSchema.errors[keyword];
        message = typeof custom === 'function' ? custom(error) : custom;
      } else if (keyword === 'required') {
        message = 'missing required property';
        path.push(params.missingProperty);
      } else if (keyword === 'additionalProperties') {
        message = 'unknown property';
        path.push(params.additionalProperty);
      } else if (keyword === 'type') {
        let dataType = Array.isArray(data) ? 'array' : typeof data;
        message = `must be ${a(params.type)}, received ${a(dataType)}`;
      }

      errors.push({ message, path });
    }
  }

  return { result, errors };
}

// Adds "a" or "an" to a word for readability.
function a(word) {
  return `${('aeiou').includes(word[0]) ? 'an' : 'a'} ${word}`;
}
