import util from 'util';
import YAML from 'yaml';
import getDefaults from './defaults';

// Provides native util.inspect with common options for printing configs.
export function inspect(config) {
  return util.inspect(config, { depth: null, compact: false });
}

// Converts a config to a yaml, json, or js string. When no config is provided,
// falls back to schema defaults.
export default function stringify(format, config = getDefaults()) {
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
