const { isArray } = Array;
const { isInteger } = Number;
const { entries } = Object;

// Creates an empty object or array
function create(array) {
  return array ? [] : {};
}

// Gets a value in the object at the path
export function get(object, path, find) {
  /* istanbul ignore next: a string path is never actually used here */
  return (isArray(path) ? path : path.split('.'))
    .reduce((target, key) => target?.[key], object);
}

// Sets a value to the object at the path creating any necessary nested
// objects or arrays along the way
const ARRAY_PATH_KEY_REG = /^\[\d+]$/;

export function set(object, path, value) {
  return (isArray(path) ? path : path.split('.'))
    .reduce((target, key, index, path) => {
      if (index < path.length - 1) {
        let childKey = path[index + 1];
        return (target[key] ??= create(
          isInteger(childKey) ||
            ARRAY_PATH_KEY_REG.test(childKey)
        ));
      } else {
        target[key] = value;
        return object;
      }
    }, object);
}

// Deletes properties from an object at the paths
export function del(object, ...paths) {
  return paths.reduce((object, path) => {
    return (isArray(path) ? path : path.split('.'))
      .reduce((target, key, index, path) => {
        if (index < path.length - 1) {
          return target?.[key];
        } else {
          delete target?.[key];
          return object;
        }
      }, object);
  }, object);
}

// Maps a value from one path to another, deleting the first path
export function map(object, from, to, transform = v => v) {
  return set(object, to, transform(
    ((isArray(from) ? from : from.split('.')))
      .reduce((target, key, index, path) => {
        let value = target?.[key];

        if (index === path.length - 1) {
          delete target?.[key];
        }

        return value;
      }, object)
  ));
}

// Steps through an object's properties calling the function with the path and value of each
function walk(object, fn, path = []) {
  if (path.length && fn([...path], object) === false) return;

  if (object != null && typeof object === 'object') {
    let isArrayObject = isArray(object);

    for (let [key, value] of entries(object)) {
      if (isArrayObject) key = parseInt(key, 10);
      walk(value, fn, [...path, key]);
    }
  }
}

// Merges source values and returns a new merged value. The map function will be called with a
// property's path, previous value, and next value; it should return an array containing any
// replacement path and value; when a replacement value not defined, values will be merged.
export function merge(sources, map) {
  return sources.reduce((target, source, i) => {
    let isSourceArray = isArray(source);

    walk(source, (path, value) => {
      let ctx = get(target, path.slice(0, -1));
      let key = path[path.length - 1];
      let prev = ctx?.[key];

      // maybe map the property path and/or value
      let [p, next] = map?.(path, prev, value) || [];
      if (p) path = [...p];

      // adjust path to concat array values when necessary
      if (next !== null && (isArray(ctx) || isInteger(key))) {
        path.splice(-1, 1, ctx?.length ?? 0);
      }

      // delete prev values
      if (next === null || (next == null && value === null)) {
        del(target, path);
      }

      // set the next or default value if there is one
      if (next != null || (next !== null && value != null && typeof value !== 'object')) {
        set(target ??= create(isSourceArray), path, next ?? value);
      }

      // do not recurse mapped objects
      return next === undefined;
    });

    return target;
  }, undefined);
}
