import os from 'os';
import PercyEnv from '@percy/env';

describe('PercyEnv', () => {
  describe('forcedPkgValue', () => {
    it('should return parsed JSON from PERCY_FORCE_PKG_VALUE', () => {
      let env = new PercyEnv({ PERCY_FORCE_PKG_VALUE: JSON.stringify({ name: '@percy/client', version: '1.0.0' }) });
      expect(env.forcedPkgValue).toEqual({ name: '@percy/client', version: '1.0.0' });
    });

    it('should return null if PERCY_FORCE_PKG_VALUE is not set', () => {
      let env = new PercyEnv({});
      expect(env.forcedPkgValue).toBeNull();
    });

    it('should return null if PERCY_FORCE_PKG_VALUE is invalid JSON', () => {
      let env = new PercyEnv({ PERCY_FORCE_PKG_VALUE: 'invalid' });
      expect(env.forcedPkgValue).toBeNull();
    });

    it('should return null if PERCY_FORCE_PKG_VALUE is null', () => {
      let env = new PercyEnv({ PERCY_FORCE_PKG_VALUE: null });
      expect(env.forcedPkgValue).toBeNull();
    });
  });

  describe('machine', () => {
    it('returns a sanitized hostname-based id and the hostname', () => {
      let env = new PercyEnv({});
      expect(env.machine.hostname).toEqual(jasmine.any(String));
      expect(env.machine.id).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    it('suffixes the CI node index and captures the run url on circle', () => {
      let env = new PercyEnv({
        CIRCLECI: 'true',
        CIRCLE_NODE_INDEX: '2',
        CIRCLE_BUILD_URL: 'https://app.circleci.com/pipelines/x/1'
      });
      expect(env.machine.id).toMatch(/\.n2$/);
      expect(env.machine.runUrl).toEqual('https://app.circleci.com/pipelines/x/1');
    });

    it('composes the github actions run url', () => {
      let env = new PercyEnv({
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'org/repo',
        GITHUB_RUN_ID: '123'
      });
      expect(env.machine.runUrl).toEqual('https://github.com/org/repo/actions/runs/123');
    });

    it('suffixes the parallel job index and captures the run url on buildkite', () => {
      let env = new PercyEnv({
        BUILDKITE: 'true',
        BUILDKITE_PARALLEL_JOB: '3',
        BUILDKITE_BUILD_URL: 'https://buildkite.com/org/pipe/builds/9'
      });
      expect(env.machine.id).toMatch(/\.n3$/);
      expect(env.machine.runUrl).toEqual('https://buildkite.com/org/pipe/builds/9');
    });

    it('captures the job url on gitlab', () => {
      let env = new PercyEnv({
        GITLAB_CI: 'true',
        CI_SERVER_VERSION: '16.0',
        CI_JOB_URL: 'https://gitlab.com/org/repo/-/jobs/42'
      });
      expect(env.machine.runUrl).toEqual('https://gitlab.com/org/repo/-/jobs/42');
    });

    it('omits the index suffix when the provider exposes no node index', () => {
      let env = new PercyEnv({ BUILDKITE: 'true' });
      expect(env.machine.id).not.toMatch(/\.n/);
    });

    it('handles circle without a node index or build url', () => {
      let env = new PercyEnv({ CIRCLECI: 'true' });
      expect(env.machine.id).not.toMatch(/\.n/);
      expect(env.machine.runUrl).toBeNull();
    });

    it('handles gitlab without a job url', () => {
      let env = new PercyEnv({ GITLAB_CI: 'true', CI_SERVER_VERSION: '16.0' });
      expect(env.machine.runUrl).toBeNull();
    });

    it('omits an incomplete github run url', () => {
      let env = new PercyEnv({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123' });
      expect(env.machine.runUrl).toBeNull();
    });

    it('returns a null run url when the provider exposes none', () => {
      let env = new PercyEnv({});
      expect(env.machine.runUrl).toBeNull();
    });

    it('degrades to null identity when the hostname cannot be read', () => {
      spyOn(os, 'hostname').and.throwError('EPERM');
      let env = new PercyEnv({});
      expect(env.machine.hostname).toBeNull();
      expect(env.machine.id).toBeNull();
    });

    it('treats an empty hostname as absent', () => {
      spyOn(os, 'hostname').and.returnValue('');
      let env = new PercyEnv({});
      expect(env.machine.hostname).toBeNull();
      expect(env.machine.id).toBeNull();
    });

    it('sanitizes characters that are invalid in a machine id', () => {
      spyOn(os, 'hostname').and.returnValue('host name/with:chars');
      let env = new PercyEnv({});
      expect(env.machine.id).toEqual('host-name-with-chars');
    });

    it('is excluded from getter debug logging', () => {
      let env = new PercyEnv({});
      env.ci; // eslint-disable-line babel/no-unused-expressions -- warm nested getters
      spyOn(env.log, 'debug');
      env.machine; // eslint-disable-line babel/no-unused-expressions
      expect(env.log.debug).not.toHaveBeenCalled();
    });
  });

  describe('testhubBuildUuid', () => {
    it('should return TH_BUILD_UUID when it is set', () => {
      let env = new PercyEnv({ TH_BUILD_UUID: 'test_id' });
      expect(env.testhubBuildUuid).toEqual('test_id');
    });

    it('should return BROWSERSTACK_TESTHUB_UUID when TH_BUILD_UUID is not set', () => {
      let env = new PercyEnv({ BROWSERSTACK_TESTHUB_UUID: 'browserstack_id' });
      expect(env.testhubBuildUuid).toEqual('browserstack_id');
    });

    it('should prioritize TH_BUILD_UUID over BROWSERSTACK_TESTHUB_UUID when both are set', () => {
      let env = new PercyEnv({
        TH_BUILD_UUID: 'test_id',
        BROWSERSTACK_TESTHUB_UUID: 'browserstack_id'
      });
      expect(env.testhubBuildUuid).toEqual('test_id');
    });

    it('should return null if neither TH_BUILD_UUID nor BROWSERSTACK_TESTHUB_UUID are set', () => {
      let env = new PercyEnv({});
      expect(env.testhubBuildUuid).toBeNull();
    });

    it('should return null if both values are null', () => {
      let env = new PercyEnv({
        TH_BUILD_UUID: null,
        BROWSERSTACK_TESTHUB_UUID: null
      });
      expect(env.testhubBuildUuid).toBeNull();
    });
  });

  describe('testhubBuildRunId', () => {
    it('should return TH_BUILD_RUN_ID when it is set', () => {
      let env = new PercyEnv({ TH_BUILD_RUN_ID: 'test_run_id' });
      expect(env.testhubBuildRunId).toEqual('test_run_id');
    });

    it('should return BROWSERSTACK_TESTHUB_RUN_ID when TH_BUILD_RUN_ID is not set', () => {
      let env = new PercyEnv({ BROWSERSTACK_TESTHUB_RUN_ID: 'browserstack_run_id' });
      expect(env.testhubBuildRunId).toEqual('browserstack_run_id');
    });

    it('should prioritize TH_BUILD_RUN_ID over BROWSERSTACK_TESTHUB_RUN_ID when both are set', () => {
      let env = new PercyEnv({
        TH_BUILD_RUN_ID: 'test_run_id',
        BROWSERSTACK_TESTHUB_RUN_ID: 'browserstack_run_id'
      });
      expect(env.testhubBuildRunId).toEqual('test_run_id');
    });

    it('should return null if neither TH_BUILD_RUN_ID nor BROWSERSTACK_TESTHUB_RUN_ID are set', () => {
      let env = new PercyEnv({});
      expect(env.testhubBuildRunId).toBeNull();
    });

    it('should return null if both values are null', () => {
      let env = new PercyEnv({
        TH_BUILD_RUN_ID: null,
        BROWSERSTACK_TESTHUB_RUN_ID: null
      });
      expect(env.testhubBuildRunId).toBeNull();
    });
  });
});
