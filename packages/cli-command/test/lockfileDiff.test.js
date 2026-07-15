import { diffLockfileDeps } from '../src/lockfileDiff.js';

function dep(version) {
  return { version, resolved: `https://registry/${version}`, integrity: `sha512-${version}` };
}

function lockfile(deps) {
  return JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 1,
    requires: true,
    dependencies: deps
  });
}

function packageJson(fields) {
  return JSON.stringify({ name: 'fixture', version: '1.0.0', ...fields });
}

const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
const describeSnyk = nodeMajor >= 18 ? describe : xdescribe;

describe('lockfileDiff', () => {
  describe('diffLockfileDeps()', () => {
    it('throws on an unsupported lockfile type', async () => {
      await expectAsync(diffLockfileDeps({
        packageJson: packageJson({}),
        oldPackageJson: packageJson({}),
        oldLockfile: lockfile({}),
        newLockfile: lockfile({}),
        lockfileType: 'composer.lock'
      })).toBeRejectedWithError(/Unsupported lockfile type: composer\.lock/);
    });
  });

  describeSnyk('diffLockfileDeps() with snyk parser', () => {
    const diff = opts => diffLockfileDeps({ lockfileType: 'package-lock.json', ...opts });

    it('flags a top-level dependency whose resolved version changed', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        packageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        oldLockfile: lockfile({ 'left-pad': dep('1.1.0') }),
        newLockfile: lockfile({ 'left-pad': dep('1.2.0') })
      })).toBeResolvedTo(['left-pad']);
    });

    it('flags an added top-level dependency', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ dependencies: {} }),
        packageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        oldLockfile: lockfile({}),
        newLockfile: lockfile({ 'left-pad': dep('1.2.0') })
      })).toBeResolvedTo(['left-pad']);
    });

    it('flags a removed top-level dependency', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        packageJson: packageJson({ dependencies: {} }),
        oldLockfile: lockfile({ 'left-pad': dep('1.2.0') }),
        newLockfile: lockfile({})
      })).toBeResolvedTo(['left-pad']);
    });

    it('flags a range-only bump even when the resolved version is identical', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        packageJson: packageJson({ dependencies: { 'left-pad': '^1.2.0' } }),
        oldLockfile: lockfile({ 'left-pad': dep('1.2.0') }),
        newLockfile: lockfile({ 'left-pad': dep('1.2.0') })
      })).toBeResolvedTo(['left-pad']);
    });

    it('returns an empty list when nothing changed', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        packageJson: packageJson({ dependencies: { 'left-pad': '^1.0.0' } }),
        oldLockfile: lockfile({ 'left-pad': dep('1.2.0') }),
        newLockfile: lockfile({ 'left-pad': dep('1.2.0') })
      })).toBeResolvedTo([]);
    });

    it('ignores changes to devDependencies', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ devDependencies: { 'left-pad': '^1.0.0' } }),
        packageJson: packageJson({ devDependencies: { 'left-pad': '^1.0.0' } }),
        oldLockfile: lockfile({ 'left-pad': dep('1.1.0') }),
        newLockfile: lockfile({ 'left-pad': dep('1.2.0') })
      })).toBeResolvedTo([]);
    });

    it('includes peerDependencies in the top-level gate', async () => {
      await expectAsync(diff({
        oldPackageJson: packageJson({ peerDependencies: { react: '^17.0.0' } }),
        packageJson: packageJson({ peerDependencies: { react: '^18.0.0' } }),
        oldLockfile: lockfile({ react: dep('17.0.2') }),
        newLockfile: lockfile({ react: dep('17.0.2') })
      })).toBeResolvedTo(['react']);
    });
  });
});
