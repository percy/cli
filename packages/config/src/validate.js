import AJV from 'ajv/dist/2019.js';
import {
  set, del,
  filterEmpty,
  parsePropertyPath,
  joinPropertyPath,
  isArrayKey
} from './utils/index.js';

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
    keyword: 'onlyAutomate',
    error: {
      message: 'property only valid with Automate integration.'
    },
    code: cxt => {
      let isAutomateProjectToken = (process.env.PERCY_TOKEN || '').split('_')[0] === 'auto';
      // we do validation only when token is passed
      if (!!process.env.PERCY_TOKEN && !isAutomateProjectToken) {
        cxt.error();
      }
    }
  }, {
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
  }, {
    keyword: 'onlyWeb',
    error: {
      message: 'property only valid with Web integration.'
    },
    code: cxt => {
      const tokenPrefix = (process.env.PERCY_TOKEN || '').split('_')[0];
      const isNotWebProjectToken = tokenPrefix === 'auto' || tokenPrefix === 'app';

      // we do validation only when token is passed
      if (!!process.env.PERCY_TOKEN && isNotWebProjectToken) {
        cxt.error();
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

// Gets the schema object from the AJV schema. If a path is provided, an array of schemas is
// returned, with each index representing the schema of each part of the path (index zero is root).
export function getSchema(name, path, root) {
  // get the root schema if necessary, resolve it, and return it when there is no path
  let schema = typeof name === 'string' ? ajv.getSchema(name)?.schema : name;
  if (!schema || !path) return schema ?? [];
  root ??= schema;

  // parse and work with one key at a time
  let [key, ...rest] = path = parsePropertyPath(path);

  // if the desired schema is one of many, we need to find the best match
  let many = (isArray(schema) ? schema : schema?.[
    ['anyOf', 'oneOf', 'allOf'].find(p => schema[p])
  ])?.map(p => getSchema(p, path, root)).sort((a, b) => (
    // the best possible match will match most of the path or loosely match
    (b.length - a.length) || ((a[0]?.type === 'object' && (
      a[0].additionalProperties !== false || a[0].unevaluatedProperties !== false
    )) ? -1 : 1)
  ))[0];

  if (many?.length) {
    return many;
  } else if (schema?.type === 'array' && isArrayKey(key)) {
    // find the remaining paths in the items schema
    return [schema].concat(getSchema(schema.items, rest, root));
  } else if (schema?.type === 'object' && path.length && schema.properties?.[key]) {
    // find the remaining paths nested in the property schema
    return [schema].concat(getSchema(schema.properties[key], rest, root));
  } else if (schema?.$ref && (path.length || Object.keys(schema).length === 1)) {
    // follow references
    let $ref = schema.$ref.startsWith('#') ? `${root.$id}${schema.$ref}` : schema.$ref;
    return getSchema($ref, path, root);
  } else if (schema && (!path.length || (
    schema.type === 'object' && schema.additionalProperties !== false
  ))) {
    // end of path matching
    return [schema];
  } else {
    // no match
    return [];
  }
}

// Adds schemas to the config schema's properties. The config schema is removed, modified, and
// replaced after the new schemas are added to clear any compiled caches. Existing schemas are
// removed and replaced as well. If a schema has an existing $id, the schema will not be added
// as config schema properties.
export function addSchema(schemas) {
  if (isArray(schemas)) {
    return schemas.map(addSchema);
  }

  if (schemas.$id) {
    let { $id } = schemas;
    if (ajv.getSchema($id)) ajv.removeSchema($id);
    return ajv.addSchema(schemas);
  }

  let config = getSchema('/config');
  ajv.removeSchema('/config');

  for (let [key, schema] of entries(schemas)) {
    if (key === '$config') {
      assign(config, (
        typeof schema === 'function'
          ? schema(config) : schema
      ));
    } else {
      let $id = `/config/${key}`;
      if (ajv.getSchema($id)) ajv.removeSchema($id);
      assign(config.properties, { [key]: { $ref: $id } });
      ajv.addSchema(schema, $id);
    }
  }

  return ajv.addSchema(config, '/config');
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
const HIDE_NESTED_KEYWORDS = ['oneOf', 'anyOf', 'allOf', 'if', 'then', 'else', 'not'];

function shouldHideError(key, path, error) {
  let { parentSchema, keyword, schemaPath } = error;

  return !(parentSchema.error || parentSchema.errors?.[keyword]) && (
    HIDE_NESTED_KEYWORDS.some(k => schemaPath.includes(`/${k}`))
  );
}

// Validates data according to the associated schema and returns a list of errors, if any.
export function validate(data, key = '/config') {
  let errors = new Map();

  if (!ajv.validate(key, data)) {
    for (let error of ajv.errors) {
      let { instancePath, parentSchema, keyword, message, params } = error;
      let path = instancePath ? instancePath.substr(1).split('/') : [];
      if (shouldHideError(key, path, error)) continue;

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
      } else if (
        keyword === 'additionalProperties' ||
          keyword === 'unevaluatedProperties'
      ) {
        message = 'unknown property';
      }

      // fix paths
      if (params.missingProperty) {
        path.push(params.missingProperty);
      } else if (params.additionalProperty) {
        path.push(params.additionalProperty);
      } else if (params.unevaluatedProperty) {
        path.push(params.unevaluatedProperty);
      } else if (params.disallowedProperty) {
        path.push(params.disallowedProperty);
      }

      // fix invalid data
      if (keyword === 'minimum') {
        set(data, path, Math.max(error.data, error.schema));
      } else if (keyword === 'maximum') {
        set(data, path, Math.min(error.data, error.schema));
      } else if (keyword === 'required') {
        del(data, path.slice(0, -1));
      } else if (!params.passingSchemas) {
        del(data, path);
      }

      // joined for error messages
      path = joinPropertyPath(path);

      // map one error per path
      errors.set(path, { path, message });
    }
    // filter empty values as a result of scrubbing
    filterEmpty(data);
  }

  if (data.regions && Array.isArray(data.regions)) {
    data.regions.forEach((region, index) => {
      /* istanbul ignore next */
      if (region.elementSelector) {
        const selectorKeys = ['elementCSS', 'elementXpath', 'boundingBox'];
        const providedKeys = selectorKeys.filter(key => region.elementSelector[key] !== undefined);

        if (providedKeys.length !== 1) {
          const pathStr = `regions[${index}].elementSelector`;
          errors.set(pathStr, {
            path: pathStr,
            message: "Exactly one of 'elementCSS', 'elementXpath', or 'boundingBox' must be provided."
          });
          delete data.regions[index];
        }
      } else {
        if (region.algorithm === 'ignore') {
          const pathStr = `regions[${index}].elementSelector`;
          errors.set(pathStr, {
            path: pathStr,
            message: "'elementSelector' is required when algorithm is 'ignore'."
          });

          delete data.regions[index];
        }
      }

      const algorithmType = region.algorithm;
      const hasConfiguration = region.configuration !== undefined;

      if (algorithmType === 'layout' || algorithmType === 'ignore') {
        if (hasConfiguration) {
          const pathStr = `regions[${index}].configuration`;
          errors.set(pathStr, {
            path: pathStr,
            message: `Configuration is not applicable for '${algorithmType}' algorithm`
          });

          delete data.regions[index];
        }
      }

      if ((algorithmType === 'standard' || algorithmType === 'intelliignore') && !hasConfiguration) {
        const pathStr = `regions[${index}]`;
        errors.set(pathStr, {
          path: pathStr,
          message: `Configuration is recommended for '${algorithmType}' algorithm`
        });
      }
    });
  }

  if (data.algorithmConfiguration) {
    const pathStr = 'algorithmConfiguration';
    const algorithmType = data.algorithm;

    if (!algorithmType) {
      errors.set(pathStr, {
        path: pathStr,
        message: 'algorithmConfiguration needs algorigthm to be passed'
      });
    }

    const nonAlgoConfigTypes = ['layout'];

    if (nonAlgoConfigTypes.includes(algorithmType)) {
      errors.set(pathStr, {
        path: pathStr,
        message: `algorithmConfiguration is not applicable for '${algorithmType}' algorithm`
      });
    }
  }

  const errorArray = Array.from(errors.values());
  return errorArray.length > 0 ? errorArray : undefined;
}

export default validate;
