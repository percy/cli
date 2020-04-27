import load, { cache } from './load';
import validate, { addSchema, resetSchema } from './validate';
import getDefaults from './defaults';
import stringify from './stringify';

// Export a single object that can be imported as PercyConfig
export default {
  load,
  cache,
  validate,
  addSchema,
  resetSchema,
  getDefaults,
  stringify
};
