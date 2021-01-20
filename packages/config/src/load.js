import { relative } from 'path';
import { cosmiconfigSync } from 'cosmiconfig';
import { isDirectorySync } from 'path-type';
import logger from '@percy/logger';
import getDefaults from './defaults';
import normalize from './normalize';
import validate from './validate';
import { inspect } from './stringify';

// Loaded configuration file cache
export const cache = new Map();

// The cosmiconfig explorer used to load config files
export const explorer = cosmiconfigSync('percy', {
  cache: false,
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
// the combined config. Loaded config files are cached and reused on next load,
// unless `reload` is true in which the file will be reloaded and the cache
// updated. Validation errors are logged as warnings and the config is returned
// unless `bail` is true. Supports kebab-case and camelCase config options and
// always returns camelCase options. Currently only supports version 2 config
// files; missing versions or other versions are discarded.
export default function load({
  path,
  overrides = {},
  reload = false,
  bail = false,
  print = false
} = {}) {
  // load cached config; when no path is specified, get the last config cached
  let config = path ? cache.get(path) : Array.from(cache)[cache.size - 1]?.[1];
  let infoDebug = print ? 'info' : 'debug';
  let errorDebug = print ? 'error' : 'debug';
  let log = logger('config');

  // load config or reload cached config
  if (path !== false && (!config || reload)) {
    try {
      let result = !path || isDirectorySync(path)
        ? explorer.search(path) : explorer.load(path);

      if (result && result.config) {
        log[infoDebug](`Found config file: ${relative('', result.filepath)}`);

        if (result.config.version !== 2) {
          log.warn('Ignoring config file - ' + (
            !result.config.version
              ? 'missing version'
              : 'unsupported version'
          ));
        } else {
          config = result.config;
          cache.set(path, config);
        }
      } else {
        log[infoDebug]('Config file not found');
      }
    } catch (error) {
      log[errorDebug]('Failed to load or parse config file');
      log[errorDebug](error);
    }
  }

  // merge found config with overrides and validate
  config = normalize(config, overrides);
  let validation = config && validate(config);

  if (validation && !validation.result) {
    log.warn('Invalid config:');

    for (let { message, path } of validation.errors) {
      log.warn(`- ${path.join('.')}: ${message}`);
      let [k, t] = [path.pop(), path.reduce((d, p) => d[p], config)];
      if (t && k in t) delete t[k];
    }

    if (bail) return;
  }

  // normalize again to remove empty values for logging
  config = normalize(config);
  if (config) log[infoDebug](`Using config:\n${inspect(config)}`);

  // merge with defaults
  return getDefaults(config);
}
