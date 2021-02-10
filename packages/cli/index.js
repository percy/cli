const { promises: fs } = require('fs');
const path = require('path');

// find plugins in a directory, matching a pattern, ignoring registered plugins
function findPlugins(dir, pattern, registered) {
  let segments = pattern.split('/');
  let regexp = new RegExp(`^${segments.pop().replace('*', '.*')}`);
  dir = path.join(dir, ...segments);

  return fs.readdir(dir).then(f => f.reduce((plugins, dirname) => {
    // exclude CLI's own directory and any directory not matching the pattern
    if (dirname === 'cli' || !regexp.test(dirname)) return plugins;

    try {
      let { name, oclif } = require(`${dir}/${dirname}/package.json`);

      // plugin's package.json have a percy oclif binary defined
      if (!registered.includes(name) && oclif && oclif.bin === 'percy') {
        return plugins.concat(name);
      }
    } catch {
      // ignore directories without a package.json
    }

    return plugins;
  }, []), () => []);
}

// automatically register/unregister plugins by altering the CLI's package.json within node_modules
async function autoRegisterPlugins() {
  let nodeModules = path.resolve(__dirname, '../..');
  let pkgPath = path.resolve(__dirname, 'package.json');
  let pkg = require(pkgPath);

  // if not installed within node_modules, look within own node_modules
  /* istanbul ignore else: always true during tests */
  if (path.basename(nodeModules) !== 'node_modules') {
    nodeModules = path.resolve(__dirname, 'node_modules');
  }

  // ensure registered plugins can be resolved
  let registered = pkg.oclif.plugins.filter(plugin => {
    if (pkg.dependencies[plugin]) return true;
    try { return !!require.resolve(plugin); } catch {}
    return false;
  });

  // find unregistered plugins
  let unregistered = await Promise.all([
    findPlugins(nodeModules, '@percy/*', registered),
    findPlugins(nodeModules, 'percy-cli-*', registered)
  ]).then(p => Array.from(new Set(p.flat())));

  // if any unregistered or unresolved registered, modify plugin registry
  if (unregistered.length || registered.length !== pkg.oclif.plugins.length) {
    pkg.oclif.plugins = registered.concat(unregistered);
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// auto register plugins before running oclif
module.exports.run = () => autoRegisterPlugins()
  .then(() => require('@oclif/command').run());
