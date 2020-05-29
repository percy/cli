import load, { cache, explorer } from './load';
import validate, { addSchema, resetSchema } from './validate';
import getDefaults from './defaults';
import stringify from './stringify';

// Export a single object that can be imported as PercyConfig
export default {
  load,
  cache,
  explorer,
  validate,
  addSchema,
  resetSchema,
  getDefaults,
  stringify
};
