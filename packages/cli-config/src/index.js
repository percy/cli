import {
  load,
  inspect,
  stringify
} from './config';
import {
  addSchema,
  resetSchema,
  getDefaults,
  validate
} from './schema';

// Export a single object that can be imported as PercyConfig
export default {
  load,
  inspect,
  stringify,
  addSchema,
  resetSchema,
  getDefaults,
  validate
};
