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

// Assigns a value to the object at the path creating any necessary nested
// objects along the way
function assign(obj, path, value) {
  path.split('.').reduce((loc, key, i, a) => (
    loc[key] = i === a.length - 1 ? value : (loc[key] || {})
  ), obj);

  return obj;
}

// Calls each registered migration function with a normalize provided config
// and a `set` function which assigns values to the returned output
export default function migrate(config) {
  let output = { version: 2 };
  let input = normalize(config);
  let set = assign.bind(null, output);

  migrations.forEach(migration => {
    migration(input, set);
  });

  return output;
}
