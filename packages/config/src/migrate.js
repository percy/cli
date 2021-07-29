import logger from '@percy/logger';
import { set, del, map } from './utils';
import normalize from './normalize';

// Global set of registered migrations
const migrations = new Map();

// Register a migration function for the main config schema by default
export function addMigration(migration, schema = '/config') {
  if (Array.isArray(migration)) {
    // accept schema as the first item in a tuple
    if (typeof migration[0] === 'string') [schema, ...migration] = migration;
    return migration.map(m => addMigration(m, schema));
  }

  if (!migrations.has(schema)) migrations.set(schema, []);
  migrations.get(schema).unshift(migration);
  return migration;
}

// Clear all migration functions
export function clearMigrations() {
  migrations.clear();
  addMigration(defaultMigration);
}

// The default config migration
addMigration(defaultMigration);
function defaultMigration(config, { set }) {
  if (config.version !== 2) set('version', 2);
}

// Calls each registered migration function with a normalize provided config
// and util functions for working with the config object
export default function migrate(config, schema = '/config') {
  config = normalize(config, { schema }) ?? {};

  if (migrations.has(schema)) {
    let util = {
      set: set.bind(null, config),
      map: map.bind(null, config),
      del: del.bind(null, config),
      log: logger('config')
    };

    for (let migration of migrations.get(schema)) {
      migration(config, util);
    }

    // normalize again to adjust for migrations
    config = normalize(config, { schema });
  }

  return config;
}
