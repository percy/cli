import Ajv from 'ajv';
import log from '@percy/logger';

const { assign, entries } = Object;

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

// Used to ensure warnings for the exact same invalid configs are never logged more than once.
const invalidCache = new Set();

// Validates config data according to the config schema and logs warnings to the
// console. Optionallly scrubs invalid values from the provided config. Returns
// true when the validation success, false otherwise.
export default function validate(config, { scrub } = {}) {
  let result = ajv.validate('config', config);

  if (!result) {
    // do not log warnings for the same config more than once
    let cacheKey = JSON.stringify(config);
    let logWarning = !invalidCache.has(cacheKey);
    invalidCache.add(cacheKey);

    if (logWarning) {
      log.warn('Invalid config:');
    }

    for (let error of ajv.errors) {
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

      if (logWarning) {
        log.warn(`- ${pre}${message}`);
      }
    }
  }

  return result;
}

// Adds "a" or "an" to a word for readability.
function a(word) {
  return `${('aeiou').includes(word[0]) ? 'an' : 'a'} ${word}`;
}
