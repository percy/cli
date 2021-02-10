import path from 'path';
import mockRequire from 'mock-require';

export function pluginMocker() {
  let pkgPath = path.resolve(__dirname, '../package.json');

  let mock = ({ plugins, packages = {} }) => {
    for (let [name, dep] of Object.entries(plugins)) {
      if (dep) mock.pkg.dependencies[name] = true;
      mock.pkg.oclif.plugins.push(name);
    }

    for (let [name, plugin] of Object.entries(packages)) {
      let dir = path.resolve(__dirname, '../node_modules');
      if (name.startsWith('@percy')) dir = path.resolve(dir, '@percy');
      let dirname = name.replace('@percy', '');

      (mock.dir[dir] ||= []).push(dirname);
      mockRequire(`${dir}/${dirname}/package.json`, plugin ? (
        { name, oclif: { bin: 'percy' } }
      ) : { name });
    }
  };

  mock.dir = {};
  mock.pkg = {
    oclif: { plugins: [] },
    dependencies: {}
  };

  mockRequire(pkgPath, mock.pkg);
  mockRequire('fs', {
    ...require('fs'),

    promises: {
      readdir: async dir => {
        if (mock.dir[dir]) return mock.dir[dir];
        throw new Error('ENOENT');
      },
      writeFile: async (path, contents) => {
        if (path === pkgPath) {
          mock.pkg = JSON.parse(contents);
        }
      }
    }
  });

  return mock;
}

export { mockRequire };
