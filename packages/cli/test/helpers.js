import path from 'path';
import { mockfs, fs } from '@percy/cli-command/test/helpers';

// Mocks the update cache file with the provided data and timestamp
export function mockUpdateCache(data, createdAt = Date.now()) {
  fs.$vol.fromJSON({ '.releases': JSON.stringify({ data, createdAt }) });
  return path.join(process.cwd(), '.releases');
}

// Mocks the filesystem and require cache to simulate installed commands
export function mockModuleCommands(atPath, cmdMocks) {
  let modulesPath = `${atPath}/node_modules`;
  let mockModules = { $modules: true };

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let pkgPath = `${modulesPath}/${pkgName}`;
    let mockPkg = { name: pkgName };

    if (cmdMock) {
      mockPkg['@percy/cli'] = { commands: ['command.js'] };

      mockModules[`${pkgPath}/command.js`] = [
        `exports.name = "${cmdMock.name}"`,
        (cmdMock.callback ? 'exports.callback = () => {}' : '')
      ].join('');

      if (cmdMock.multiple) {
        mockPkg['@percy/cli'].commands.push('other.js');

        mockModules[`${pkgPath}/other.js`] = [
          `exports.name = "${cmdMock.name}-other"`
        ].join('');
      }
    }

    mockModules[`${pkgPath}/package.json`] = JSON.stringify(mockPkg);
  }

  // for coverage
  mockModules[`${modulesPath}/@percy/.DS_Store`] = 'Not a directory';
  mockModules[`${modulesPath}/.DS_Store`] = 'Not a directory';

  return mockfs(mockModules);
}

// Mocks Yarn's PnP APIs to work as expected for installed commands
export async function mockPnpCommands(atPath, cmdMocks) {
  let Module = await import('module');
  let findPnpApi = spyOn(Module, 'findPnpApi').and.callThrough();
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
  let mockModules = { $modules: true };

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let pkgLoc = { name: pkgName, ref: `<${pkgName}-pnpref>` };
    let pkgInfo = { packageLocation: `${pnpPath}/${pkgName}` };
    let mockPkg = { name: pkgName };

    projectInfo.packageDependencies.set(pkgName, pkgLoc.ref);
    getLocator.withArgs(pkgName, pkgLoc.ref).and.returnValue(pkgLoc);
    getPackageInformation.withArgs(pkgLoc).and.returnValue(pkgInfo);

    if (cmdMock) {
      mockPkg['@percy/cli'] = { commands: ['command.js'] };
      mockModules[`${pnpPath}/${pkgName}/command.js`] = `exports.name = "${cmdMock.name}"`;
    }

    mockModules[`${pnpPath}/${pkgName}/package.json`] = JSON.stringify(mockPkg);
  }

  return mockfs(mockModules);
}

// Mocks the filesystem and require cache to simulate installed legacy commands
export function mockLegacyCommands(atPath, cmdMocks) {
  let modulesPath = `${atPath}/node_modules`;
  let mockModules = { $modules: true };

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let pkgPath = `${modulesPath}/${pkgName}`;
    let mockPkg = { name: pkgName };

    if (cmdMock) {
      let entryPath = `${pkgPath}/commands/${cmdMock.name}`;
      mockPkg.oclif = { bin: 'percy' };

      if (cmdMock.topic || cmdMock.index) {
        mockModules[`${entryPath}/notcmd.js`] = 'module.exports = {}';
        mockModules[`${entryPath}/subcmd.js`] = 'exports.Command = ' +
          'class LegacySubCmd { run() {} }';

        if (cmdMock.index) {
          mockModules[`${entryPath}/index.js`] = 'exports.Command = ' +
            'class LegacyIndex { run() {} }';
        }
      } else {
        mockModules[`${entryPath}.js`] = 'exports.Command = ' +
          'class LegacyCommand { run() {} }';
      }

      if (cmdMock.init) {
        mockModules[`${pkgPath}/init.js`] = `module.exports = ${cmdMock.init}`;
        mockPkg.oclif.hooks = { init: 'init.js' };
      } else {
        mockPkg.oclif.commands = 'commands';
      }
    }

    mockModules[`${pkgPath}/package.json`] = JSON.stringify(mockPkg);
  }

  return mockfs(mockModules);
}
