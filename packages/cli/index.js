const { promises: fs } = require('fs');
const path = require('path');

// find plugins in a directory, matching a regexp, ignoring registered plugins
function findPlugins(dir, regexp, registered) {
  return fs.readdir(dir).then(f => f.reduce((plugins, dirname) => {
    if (dirname === 'cli' || !regexp.test(dirname)) return plugins;

    let { name, oclif } = require(`${dir}/${dirname}/package.json`);

    if (!registered.includes(name) && oclif && oclif.bin === 'percy') {
      return plugins.concat(name);
    } else {
      return plugins;
    }
  }, []));
}

// automatically register/unregister plugins by altering the CLI's package.json within node_modules
async function autoRegisterPlugins() {
  let pkgPath = path.resolve(__dirname, 'package.json');
  let pkg = require(pkgPath);

  let registered = pkg.oclif.plugins.filter(plugin => {
    if (pkg.dependencies[plugin]) return true;
    try { return !!require.resolve(plugin); } catch {}
    return false;
  });

  let unregistered = await Promise.all([
    findPlugins(path.resolve(__dirname, '..'), /^.*/, registered), // @percy/*
    findPlugins(path.resolve(__dirname, '../..'), /^percy-cli-.*/, registered) // percy-cli-*
  ]).then(p => Array.from(new Set(p.flat())));

  if (unregistered.length || registered.length !== pkg.oclif.plugins.length) {
    pkg.oclif.plugins = registered.concat(unregistered);
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// auto register plugins before running oclif
module.exports.run = () => autoRegisterPlugins()
  .then(() => require('@oclif/command').run());
