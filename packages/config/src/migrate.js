import logger from '@percy/logger';
import { set, del, map, merge } from './utils';
import normalize from './normalize';

// Global set of registered migrations
const migrations = new Set();

// Register a migration function
export function addMigration(migration) {
  migrations.add(migration);
}

// Clear all migration functions
export function clearMigrations() {
  migrations.clear();
}

// Calls each registered migration function with a normalize provided config
// and util functions for working with the config object
export default function migrate(config) {
  config = normalize(config);

  let util = {
    set: set.bind(null, config),
    map: map.bind(null, config),
    del: del.bind(null, config),
    log: logger('config')
  };

  for (let migration of migrations) {
    migration(config, util);
  }

  return merge([config, {
    version: 2
  }]);
}
