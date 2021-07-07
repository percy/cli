import AJV from 'ajv';
import { set, del } from './utils';

const { isArray } = Array;
const { assign, entries } = Object;

// AJV manages and validates schemas.
const ajv = new AJV({
  strict: false,
  verbose: true,
  allErrors: true,
  schemas: [
    getDefaultSchema()
  ],
  keywords: [{
    // custom instanceof schema validation
    keyword: 'instanceof',
    metaSchema: {
      enum: ['Function', 'RegExp']
    },
    error: {
      message: cxt => AJV.str`must be an instanceof ${cxt.schemaCode}`,
      params: cxt => AJV._`{ instanceof: ${cxt.schemaCode} }`
    },
    code: cxt => cxt.fail(
      AJV._`!(${cxt.data} instanceof ${AJV._([cxt.schema])})`
    )
  }, {
    // disallowed validation based on required
    keyword: 'disallowed',
    metaSchema: {
      type: 'array',
      items: { type: 'string' }
    },
    error: {
      message: 'disallowed property',
      params: cxt => AJV._`{ disallowedProperty: ${cxt.params.disallowedProperty} }`
    },
    code: cxt => {
      let { data, gen, schema } = cxt;

      for (let prop of schema) {
        gen.if(AJV._`${data}.${AJV._([prop])} !== undefined`, () => {
          cxt.setParams({ disallowedProperty: AJV._`${prop}` }, true);
          cxt.error();
        });
      }
    }
  }]
});

// Returns a new default schema.
function getDefaultSchema() {
  return {
    $id: '/config',
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

// Adds schemas to the config schema's properties. The config schema is removed, modified, and
// replaced after the new schemas are added to clear any compiled caches. Existing schemas are
// removed and replaced as well. If a schema id is provided as the second argument, the schema
// will be set independently and not added to config schema's properties.
export function addSchema(schemas) {
  if (isArray(schemas) || schemas.$id) {
    return ajv.addSchema(schemas);
  }

  let config = getSchema('/config');
  ajv.removeSchema('/config');

  for (let [key, schema] of entries(schemas)) {
    let $id = `/config/${key}`;
    if (ajv.getSchema($id)) ajv.removeSchema($id);
    assign(config.properties, { [key]: { $ref: $id } });
    ajv.addSchema(schema, $id);
  }

  ajv.addSchema(config, '/config');
}

// Resets the schema by removing all schemas and inserting a new default schema.
export function resetSchema() {
  ajv.removeSchema();
  ajv.addSchema(getDefaultSchema(), '/config');
}

// Adds "a" or "an" to a word for readability.
function a(word) {
  if (word === 'undefined' || word === 'null') return word;
  return `${('aeiou').includes(word[0]) ? 'an' : 'a'} ${word}`;
}

// Default errors anywhere within these keywords can be confusing
const HIDE_NESTED_KEYWORDS = ['oneOf', 'anyOf', 'allOf', 'not'];

function shouldHideError({ parentSchema, keyword, schemaPath }) {
  return !(parentSchema.error || parentSchema.errors?.[keyword]) &&
    HIDE_NESTED_KEYWORDS.some(k => schemaPath.includes(`/${k}`));
}

// Validates data according to the associated schema and returns a list of errors, if any.
export default function validate(data, key = '/config') {
  if (!ajv.validate(key, data)) {
    let errors = new Map();

    for (let error of ajv.errors) {
      if (shouldHideError(error)) continue;
      let { instancePath, parentSchema, keyword, message, params } = error;
      let path = instancePath ? instancePath.substr(1).split('/') : [];

      // generate a custom error message
      if (parentSchema.error || parentSchema.errors?.[keyword]) {
        let custom = parentSchema.error || parentSchema.errors[keyword];
        message = typeof custom === 'function' ? custom(error) : custom;
      } else if (keyword === 'type') {
        let dataType = error.data === null ? 'null' : (
          isArray(error.data) ? 'array' : typeof error.data);
        message = `must be ${a(params.type)}, received ${a(dataType)}`;
      } else if (keyword === 'required') {
        message = 'missing required property';
      } else if (keyword === 'additionalProperties') {
        message = 'unknown property';
      }

      // fix paths
      if (params.missingProperty) {
        path.push(params.missingProperty);
      } else if (params.additionalProperty) {
        path.push(params.additionalProperty);
      } else if (params.disallowedProperty) {
        path.push(params.disallowedProperty);
      }

      // fix invalid data
      if (keyword === 'minimum') {
        set(data, path, Math.max(error.data, error.schema));
      } else if (keyword === 'maximum') {
        set(data, path, Math.min(error.data, error.schema));
      } else {
        del(data, path);
      }

      // joined for error messages
      path = path.join('.');

      // map one error per path
      errors.set(path, { path, message });
    }

    // return an array of errors
    return Array.from(errors.values());
  }
}
