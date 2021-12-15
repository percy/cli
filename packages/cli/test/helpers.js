import path from 'path';
import * as memfs from 'memfs';
import mockRequire from 'mock-require';

export { mockRequire };

// Helper function to mock fs with memfs and proxy methods to memfs.vol
export const mockfs = new Proxy(
  () => mockRequire('fs', memfs.fs),
  { get: (_, k) => (...a) => memfs.vol[k](...a) }
);

// Mocks the filesystem and require cache to simulate installed commands
export function mockModuleCommands(atPath, cmdMocks) {
  let modulesPath = path.join(atPath, 'node_modules');
  let mockModules = {};

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    mockModules[pkgName] = {};

    let mockPkg = { name: pkgName };
    mockRequire(path.join(modulesPath, pkgName, 'package.json'), mockPkg);

    if (cmdMock) {
      let mockCmd = { name: cmdMock.name };
      if (cmdMock.callback) mockCmd.callback = () => {};
      mockPkg['@percy/cli'] = { commands: ['command'] };
      mockRequire(path.join(modulesPath, pkgName, 'command'), mockCmd);

      if (cmdMock.multiple) {
        mockPkg['@percy/cli'].commands.push('other');
        let mockOther = { name: cmdMock.name + '-other' };
        mockRequire(path.join(modulesPath, pkgName, 'other'), mockOther);
      }
    }
  }

  // for coverage
  mockModules['@percy/.DS_Store'] = 'Not a directory';
  mockModules['.DS_Store'] = 'Not a directory';

  mockfs.fromJSON(mockModules, modulesPath);
}

// Mocks Yarn's PnP APIs to work as expected for installed commands
export async function mockPnpCommands(atPath, cmdMocks) {
  let { findPnpApi } = await import('module');
  if (!jasmine.isSpy(findPnpApi)) return;

  let projectLoc = { name: 'project', ref: '<project-pnpref>' };
  let projectInfo = { packageLocation: `${atPath}/`, packageDependencies: new Map() };
  let findPackageLocator = jasmine.createSpy('findPackageLocator');
  let getPackageInformation = jasmine.createSpy('getPackageInformation');
  let getLocator = jasmine.createSpy('getLocator');

  let pnpApi = { findPackageLocator, getPackageInformation, getLocator };
  findPnpApi.withArgs(projectInfo.packageLocation).and.returnValue(pnpApi);
  findPackageLocator.withArgs(projectInfo.packageLocation).and.returnValue(projectLoc);
  getPackageInformation.withArgs(projectLoc).and.returnValue(projectInfo);

  let pnpPath = path.join('/.yarn/berry/cache');

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let pkgLoc = { name: pkgName, ref: `<${pkgName}-pnpref>` };
    let pkgInfo = { packageLocation: path.join(pnpPath, pkgName) };

    projectInfo.packageDependencies.set(pkgName, pkgLoc.ref);
    getLocator.withArgs(pkgName, pkgLoc.ref).and.returnValue(pkgLoc);
    getPackageInformation.withArgs(pkgLoc).and.returnValue(pkgInfo);

    let mockPkg = { name: pkgName };
    mockRequire(path.join(pnpPath, pkgName, 'package.json'), mockPkg);

    if (cmdMock) {
      let mockCmd = { name: cmdMock.name };
      mockPkg['@percy/cli'] = { commands: ['command'] };
      mockRequire(path.join(pnpPath, pkgName, 'command'), mockCmd);
    }
  }
}

// Mocks the filesystem and require cache to simulate installed legacy commands
export function mockLegacyCommands(atPath, cmdMocks) {
  let modulesPath = path.join(atPath, 'node_modules');
  let mockModules = {};

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let mockPkg = { name: pkgName };
    mockRequire(path.join(modulesPath, pkgName, 'package.json'), mockPkg);

    if (cmdMock) {
      let mockPath = path.join(pkgName, 'commands', cmdMock.name);
      mockPkg.oclif = { bin: 'percy' };

      if (cmdMock.topic || cmdMock.index) {
        mockModules[path.join(mockPath, 'subcmd.js')] = '';
        mockModules[path.join(mockPath, 'notcmd.js')] = '';

        if (cmdMock.index) {
          mockModules[path.join(mockPath, 'index.js')] = '';
        }
      } else {
        mockModules[mockPath + '.js'] = '';
      }

      if (cmdMock.init) {
        mockPkg.oclif.hooks = { init: 'init' };
        mockRequire(path.join(modulesPath, pkgName, 'init'), cmdMock.init);
      } else {
        let cmdsPath = path.join(modulesPath, pkgName, 'commands');
        mockPkg.oclif.commands = 'commands';

        if (cmdMock.topic || cmdMock.index) {
          mockRequire(path.join(cmdsPath, cmdMock.name, 'notcmd'), {});
          mockRequire(path.join(cmdsPath, cmdMock.name, 'subcmd'), (
            { Command: class LegacySubCmd { run() {} } }));

          if (cmdMock.index) {
            mockRequire(path.join(cmdsPath, cmdMock.name, 'index'), (
              { Command: class LegacyIndex { run() {} } }));
          }
        } else {
          mockRequire(path.join(cmdsPath, cmdMock.name), (
            { Command: class LegacyCommand { run() {} } }));
        }
      }
    }
  }

  mockfs.fromJSON(mockModules, modulesPath);
}
