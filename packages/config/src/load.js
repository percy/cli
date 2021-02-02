import { relative } from 'path';
import { statSync } from 'fs';
import { cosmiconfigSync } from 'cosmiconfig';
import logger from '@percy/logger';
import getDefaults from './defaults';
import migrate from './migrate';
import normalize from './normalize';
import { inspect } from './stringify';
import validate from './validate';

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
// always returns camelCase options. Will automatically convert older config
// versions to the latest version while printing a warning.
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
      let result = !path || statSync(path).isDirectory()
        ? explorer.search(path) : explorer.load(path);

      if (result && result.config) {
        log[infoDebug](`Found config file: ${relative('', result.filepath)}`);
        let version = parseInt(result.config.version, 10);

        if (Number.isNaN(version)) {
          log.warn('Ignoring config file - missing or invalid version');
        } else if (version > 2) {
          log.warn(`Ignoring config file - unsupported version "${version}"`);
        } else {
          if (version < 2) {
            log.warn('Found older config file version, please run ' + (
              '`percy config:migrate` to update to the latest version'));
            config = migrate(result.config);
          } else {
            config = result.config;
          }

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
