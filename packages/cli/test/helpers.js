import fs from 'fs';
import url from 'url';
import path from 'path';
import { mockfs } from '@percy/cli-command/test/helpers';

// Mocks the update cache file with the provided data and timestamp
export function mockUpdateCache(data, createdAt = Date.now()) {
  fs.$vol.fromJSON({ '.releases': JSON.stringify({ data, createdAt }) });
  return path.join(process.cwd(), '.releases');
}

// Mocks the filesystem and require cache to simulate installed commands
export function mockModuleCommands(atPath, cmdMocks) {
  let modulesPath = `${atPath}/node_modules`;
  let vol = mockfs({ $modules: true, [modulesPath]: null });
  let write = (rel, str) => vol.fromJSON({ [`${modulesPath}/${rel}`]: str });

  // for coverage
  write('.DS_Store', 'Not a directory');
  write('@percy/.DS_Store', 'Not a directory');

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let mockPkg = { name: pkgName };

    if (cmdMock) {
      mockPkg['@percy/cli'] = { commands: ['command.js'] };

      write(`${pkgName}/command.js`, `export default {
        name: "${cmdMock.name}",
        ${(cmdMock.callback ? 'callback() {}' : '')}
      }`);

      if (cmdMock.multiple) {
        mockPkg['@percy/cli'].commands.push('other.js');
        write(`${pkgName}/other.js`, `export default {
          name: "${cmdMock.name}-other"
        }`);
      }
    }

    write(`${pkgName}/package.json`, JSON.stringify(mockPkg));
  }
}

// Mocks Yarn's PnP APIs to work as expected for installed commands
export async function mockPnpCommands(atPath, cmdMocks) {
  let { default: Module } = await import('module');
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

  let vol = mockfs({ $modules: true });
  let pnpPath = path.join('/.yarn/berry/cache');
  let write = (fp, str) => vol.fromJSON({ [`${pnpPath}/${fp}`]: str });

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let pkgLoc = { name: pkgName, ref: `<${pkgName}-pnpref>` };
    let pkgInfo = { packageLocation: `${pnpPath}/${pkgName}` };
    let mockPkg = { name: pkgName };

    projectInfo.packageDependencies.set(pkgName, pkgLoc.ref);
    getLocator.withArgs(pkgName, pkgLoc.ref).and.returnValue(pkgLoc);
    getPackageInformation.withArgs(pkgLoc).and.returnValue(pkgInfo);

    if (cmdMock) {
      mockPkg['@percy/cli'] = { commands: ['command.js'] };
      write(`${pkgName}/command.js`, `export default { name: "${cmdMock.name}" }`);
    }

    write(`${pkgName}/package.json`, JSON.stringify(mockPkg));
  }
}

// Mocks the filesystem and require cache to simulate installed legacy commands
export function mockLegacyCommands(atPath, cmdMocks) {
  let modulesPath = `${atPath}/node_modules`;
  let vol = mockfs({ $modules: true, [modulesPath]: null });
  let write = (fp, str) => vol.fromJSON({ [`${modulesPath}/${fp}`]: str });

  for (let [pkgName, cmdMock] of Object.entries(cmdMocks)) {
    let mockPkg = { name: pkgName };

    if (cmdMock) {
      let entryPath = `${pkgName}/commands/${cmdMock.name}`;
      mockPkg.oclif = { bin: 'percy' };

      if (cmdMock.topic || cmdMock.index) {
        write(`${entryPath}/notcmd.js`, 'module.exports = {}');
        write(`${entryPath}/subcmd.js`, 'export class LegacySubCmd { run() {} }');

        if (cmdMock.index) {
          write(`${entryPath}/index.js`, 'export class LegacyIndex { run() {} }');
        }
      } else {
        write(`${entryPath}.js`, 'export class LegacyCommand { run() {} }');
      }

      if (cmdMock.init) {
        let initURL = url.pathToFileURL(`${modulesPath}/${pkgName}/init.js`).href;
        global.__MOCK_IMPORTS__.set(initURL, { default: cmdMock.init });
        mockPkg.oclif.hooks = { init: 'init.js' };
      } else {
        mockPkg.oclif.commands = 'commands';
      }
    }

    write(`${pkgName}/package.json`, JSON.stringify(mockPkg));
  }
}
