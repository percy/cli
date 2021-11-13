import load, { cache, explorer, search } from './load';
import validate, { addSchema, resetSchema } from './validate';
import migrate, { addMigration, clearMigrations } from './migrate';
import getDefaults from './defaults';
import normalize from './normalize';
import stringify from './stringify';

export {
  load,
  search,
  cache,
  explorer,
  validate,
  addSchema,
  resetSchema,
  migrate,
  addMigration,
  clearMigrations,
  getDefaults,
  normalize,
  stringify
};

// mirror the namespace as the default export
export default {
  load,
  search,
  cache,
  explorer,
  validate,
  addSchema,
  resetSchema,
  migrate,
  addMigration,
  clearMigrations,
  getDefaults,
  normalize,
  stringify
};
