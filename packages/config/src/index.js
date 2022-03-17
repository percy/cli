import load, { search } from './load';
import validate, { addSchema } from './validate';
import migrate, { addMigration } from './migrate';
import { merge, normalize, stringify } from './utils';
import getDefaults from './defaults';

// public config API
export {
  load,
  search,
  validate,
  addSchema,
  migrate,
  addMigration,
  getDefaults,
  merge,
  normalize,
  stringify
};

// export the namespace by default
export * as default from '.';
