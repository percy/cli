import util from 'util';
import { cosmiconfigSync } from 'cosmiconfig';
import merge from 'deepmerge';
import YAML from 'yaml';
import log from '@percy/logger';
import { getDefaults, validate } from './schema';

// The cosmiconfig explorer used to load config files
const explorer = cosmiconfigSync('percy', {
  searchPlaces: [
    'package.json',
    '.percyrc',
    '.percy.json',
    '.percy.yaml',
    '.percy.yml',
    '.percy.js',
    'percy.config.js'
  ]
});

// Finds and loads a config file using cosmiconfig, merges it with optional
// inputs, validates the combined config according to the schema, and returns
// the combined config. Validation errors are logged as warnings and the config
// is returned unless `bail` is true. Supports kebab-case and camelCase config
// options and always returns camelCase options. Currently only supports version
// 2 config files; missing versions or other versions are discarded and a
// warning is logged.
export function load(filepath, input, bail) {
  let config = {};

  try {
    let result = filepath
      ? explorer.load(filepath)
      : explorer.search();

    if (result && result.config) {
      log.debug(`Found config file: ${result.filepath}`);

      if (result.config.version !== 2) {
        log.warn('Ignoring config file - ' + (
          !result.config.version
            ? 'missing version'
            : 'unsupported version'
        ));
      } else {
        // normalize to remove empty values and convert snake-case to camelCase
        config = normalizeConfig(result.config);
      }
    } else {
      log.debug('Config file not found');
    }
  } catch (error) {
    log.debug('Failed to load or parse config file');
    log.debug(error.toString());
  }

  // merge options and validate while scrubbing invalid values
  config = input ? merge(config, input) : config;
  let errors = validate(config, true);

  if (errors) {
    log.warn('Invalid config:');
    for (let err of errors) log.warn(`- ${err}`);
    if (bail) return;
  }

  // normalize again to remove empty values from input and validation scrubbing
  config = normalizeConfig(config);

  if (config) {
    log.debug(`Using config:\n${inspect(config)}`);
  }

  return merge.all([getDefaults(), config ?? {}], {
    // overwrite default arrays, do not merge
    arrayMerge: (_, arr) => arr
  });
}

// Provides native util.inspect with common options for printing configs.
export function inspect(config) {
  return util.inspect(config, { depth: null, compact: false });
}

// Converts a config to a yaml, json, or js string. When no config is provided,
// falls back to schema defaults.
export function stringify(format, config = getDefaults()) {
  switch (format) {
    case 'yaml':
      return YAML.stringify(config);
    case 'json':
      return JSON.stringify(config, null, 2);
    case 'js':
      return `module.exports = ${inspect(config)}`;
    default:
      return '';
  }
}

// recursively reduces config objects and arrays to remove undefined and empty
// values and rename kebab-case properties to camelCase.
function normalizeConfig(subject) {
  if (typeof subject === 'object') {
    let isArray = Array.isArray(subject);

    return Object.entries(subject)
      .reduce((result, [key, value]) => {
        value = normalizeConfig(value);

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

// Converts a kebab-cased string to camelCase.
function camelize(s) {
  return s.replace(/-./g, l => l.toUpperCase()[1]);
}
