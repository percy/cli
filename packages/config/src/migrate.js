import logger from '@percy/logger';
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

// Sets a value to the object at the path creating any necessary nested
// objects along the way
function set(obj, path, value) {
  path.split('.').reduce((loc, key, i, a) => (
    loc[key] = i === a.length - 1 ? value : (loc[key] || {})
  ), obj);

  return obj;
}

// Maps a value from one path to another, deleting the first path
function map(obj, from, to, map = v => v) {
  let val = from.split('.').reduce((loc, key, i, a) => {
    let val = loc && loc[key];
    if (loc && i === a.length - 1) delete loc[key];
    return val;
  }, obj);

  return set(obj, to, map(val));
}

// Deletes properties from an object at the paths
function del(obj, ...paths) {
  for (let path of paths) {
    path.split('.').reduce((loc, key, i, a) => {
      if (loc && i === a.length - 1) delete loc[key];
      return loc && loc[key];
    }, obj);
  }

  return obj;
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

  migrations.forEach(migration => {
    migration(config, util);
  });

  return normalize(config, {
    overrides: { version: 2 }
  });
}
