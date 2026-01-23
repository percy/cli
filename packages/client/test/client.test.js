import fs from 'fs';
import logger from '@percy/logger/test/helpers';
import { mockgit } from '@percy/env/test/helpers';
import { sha256hash, base64encode } from '@percy/client/utils';
import PercyClient from '@percy/client';
import api, { mockRequests } from './helpers.js';
import * as CoreConfig from '@percy/core/config';
import PercyConfig from '@percy/config';
import Pako from 'pako';

describe('PercyClient', () => {
  let client;

  beforeEach(async () => {
    await logger.mock({ level: 'debug' });
    await api.mock();
    delete process.env.PERCY_GZIP;
    process.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
    client = new PercyClient({
      token: 'PERCY_TOKEN'
    });
  });

  describe('#userAgent()', () => {
    it('uses default package value when env.forcedPkgValue is not set', () => {
      delete process.env.PERCY_FORCE_PKG_VALUE;
      client = new PercyClient({ token: 'PERCY_TOKEN' });

      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/\S+ \(node\/v[\d.]+.*\)$/
      );
    });
    it('contains client and environment information', () => {
      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/\S+ \(node\/v[\d.]+.*\)$/
      );
    });

    it('contains any additional client and environment information', () => {
      client = new PercyClient({
        token: 'PERCY_TOKEN',
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });

      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/\S+ client-info \(env-info; node\/v[\d.]+.*\)$/
      );
      expect(logger.stderr.length).toBeGreaterThanOrEqual(2);
    });

    it('it logs a debug warning when no info is passed', async () => {
      await expectAsync(client.createSnapshot(123, {
        name: 'snapfoo',
        widths: [1000],
        minHeight: 1000,
        enableJavaScript: true,
        resources: [{
          url: '/foobar',
          content: 'foo',
          mimetype: 'text/html',
          root: true
        }]
      })).toBeResolved();

      expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:client] Warning: Missing `clientInfo` and/or `environmentInfo` properties']));
    });

    it('it logs a debug warning when partial info is passed', async () => {
      client = new PercyClient({
        token: 'PERCY_TOKEN',
        clientInfo: 'client-info'
      });

      await expectAsync(client.createSnapshot(123, {
        name: 'snapfoo',
        widths: [1000],
        minHeight: 1000,
        enableJavaScript: true,
        resources: [{
          url: '/foobar',
          content: 'foo',
          mimetype: 'text/html',
          root: true
        }]
      })).toBeResolved();

      expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:client] Warning: Missing `clientInfo` and/or `environmentInfo` properties']));
    });

    it('does not duplicate or include empty client and environment information', () => {
      client.addClientInfo(null);
      client.addClientInfo(undefined);
      client.addClientInfo('');
      client.addClientInfo('client-info');
      client.addClientInfo('client-info');
      client.addClientInfo(['client-info', 'client-info']);
      client.addEnvironmentInfo(null);
      client.addEnvironmentInfo(undefined);
      client.addEnvironmentInfo('');
      client.addEnvironmentInfo('env-info');
      client.addEnvironmentInfo('env-info');
      client.addEnvironmentInfo(['env-info', 'env-info']);

      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/\S+ client-info \(env-info; node\/v[\d.]+.*\)$/
      );
    });

    it('uses forced package value when set', () => {
      client.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
      client = new PercyClient({
        token: 'PERCY_TOKEN'
      });
      client.env.PERCY_FORCE_PKG_VALUE = JSON.stringify({ name: '@percy/client', version: '1.0.0' });
      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/1.0.0 \(node\/v[\d.]+.*\)$/
      );
    });
  });

  describe('#get()', () => {
    it('sends a GET request to the API', async () => {
      await expectAsync(client.get('foobar')).toBeResolved();
      expect(api.requests['/foobar'][0].method).toBe('GET');
      expect(api.requests['/foobar'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: 'Token token=PERCY_TOKEN'
        })
      );
    });

    it('throws when missing a percy token', () => {
      expect(() => new PercyClient().get('foobar'))
        .toThrowError('Missing Percy token');
    });
  });

  describe('#post()', () => {
    it('sends a POST request to the API', async () => {
      await expectAsync(client.post('foobar', { test: '123' })).toBeResolved();
      expect(api.requests['/foobar'][0].body).toEqual({ test: '123' });
      expect(api.requests['/foobar'][0].method).toBe('POST');
      expect(api.requests['/foobar'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: 'Token token=PERCY_TOKEN',
          'Content-Type': 'application/vnd.api+json'
        })
      );
    });

    it('sends a POST request to the API without payload', async () => {
      await expectAsync(client.post('foobar')).toBeResolved();
      expect(api.requests['/foobar'][0].body).toEqual({});
      expect(api.requests['/foobar'][0].method).toBe('POST');
      expect(api.requests['/foobar'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: 'Token token=PERCY_TOKEN',
          'Content-Type': 'application/vnd.api+json'
        })
      );
    });

    it('throws when missing a percy token', () => {
      expect(() => new PercyClient().post('foobar', {}))
        .toThrowError('Missing Percy token');
    });

    it('sends a POST request with both custom headers and projectTokenRequired=false', async () => {
      const customHeaders = {
        'X-Custom-Header': 'custom-value',
        'Content-Type': 'application/json'
      };

      spyOn(client, 'headers').and.callThrough();

      await expectAsync(client.post('foobar', { test: '123' }, {}, customHeaders, false)).toBeResolved();

      expect(client.headers).toHaveBeenCalledWith(
        jasmine.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value'
        }),
        false
      );

      expect(api.requests['/foobar'][0].headers).toEqual(
        jasmine.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value'
        })
      );
    });
  });

  describe('#createBuild()', () => {
    let cliStartTime = new Date().toISOString();
    beforeEach(() => {
      delete process.env.PERCY_AUTO_ENABLED_GROUP_BUILD;
      delete process.env.PERCY_ORIGINATED_SOURCE;
    });

    it('creates a new build', async () => {
      await expectAsync(client.createBuild()).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'user_created',
            partial: client.env.partial,
            tags: []
          }
        }));
    });

    it('creates a new build with projectType passed as null', async () => {
      await expectAsync(client.createBuild({ projectType: null })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: null,
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'user_created',
            partial: client.env.partial,
            tags: []
          }
        }));
    });

    it('creates a new build with resources', async () => {
      await expectAsync(client.createBuild({
        resources: [{
          url: '/foobar',
          sha: 'provided-sha',
          mimetype: 'text/html',
          root: true
        }, {
          url: '/bazqux',
          content: 'content-sha'
        }]
      })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          relationships: {
            resources: {
              data: [{
                type: 'resources',
                id: 'provided-sha',
                attributes: {
                  'resource-url': '/foobar',
                  'is-root': true,
                  mimetype: 'text/html'
                }
              }, {
                type: 'resources',
                id: sha256hash('content-sha'),
                attributes: {
                  'resource-url': '/bazqux',
                  'is-root': null,
                  mimetype: null
                }
              }]
            }
          }
        }));
    });

    it('creates a new build with projectType', async () => {
      await expectAsync(client.createBuild({ projectType: 'web' })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'user_created',
            partial: client.env.partial,
            tags: []
          }
        }));
    });

    it('creates a new build with tags', async () => {
      client = new PercyClient({
        token: 'PERCY_TOKEN',
        labels: 'tag1,tag2'
      });
      await expectAsync(client.createBuild({ projectType: 'web' })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'user_created',
            partial: client.env.partial,
            tags: [{ id: null, name: 'tag1' }, { id: null, name: 'tag2' }]
          }
        }));
    });

    it('creates a new build with cliStartTime', async () => {
      process.env.PERCY_AUTO_ENABLED_GROUP_BUILD = 'true';
      client = new PercyClient({
        token: 'PERCY_TOKEN',
        labels: 'tag1,tag2'
      });
      await expectAsync(client.createBuild({ projectType: 'web', cliStartTime })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': cliStartTime,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'auto_enabled_group',
            partial: client.env.partial,
            tags: [{ id: null, name: 'tag1' }, { id: null, name: 'tag2' }]
          }
        }));
    });

    it('creates a new build with skipBaseBuild config', async () => {
      client = new PercyClient({
        token: 'PERCY_TOKEN',
        config: { percy: { skipBaseBuild: true } }
      });
      await expectAsync(client.createBuild({ projectType: 'web' })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'user_created',
            partial: client.env.partial,
            'skip-base-build': true,
            tags: []
          }
        }));
    });

    it('creates a new build with testhub-build-uuid', async () => {
      process.env.TH_BUILD_UUID = 'test-uuid-123';
      await expectAsync(client.createBuild({ projectType: 'web' })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': 'test-uuid-123',
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'user_created',
            partial: client.env.partial,
            tags: []
          }
        }));
    });

    it('creates a new build with testhub-build-run-id', async () => {
      process.env.TH_BUILD_RUN_ID = 'test-run-id-123';
      await expectAsync(client.createBuild({ projectType: 'web' })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': 'test-run-id-123',
            source: 'user_created',
            partial: client.env.partial,
            tags: []
          }
        }));
    });

    it('creates a new build with source set to bstack_sdk_created when PERCY_ORIGINATED_SOURCE is set', async () => {
      process.env.PERCY_ORIGINATED_SOURCE = 'true';
      await expectAsync(client.createBuild({ projectType: 'web' })).toBeResolvedTo({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(api.requests['/builds'][0].body.data)
        .toEqual(jasmine.objectContaining({
          attributes: {
            branch: client.env.git.branch,
            type: 'web',
            'target-branch': client.env.target.branch,
            'target-commit-sha': client.env.target.commit,
            'commit-sha': client.env.git.sha,
            'commit-committed-at': client.env.git.committedAt,
            'commit-author-name': client.env.git.authorName,
            'commit-author-email': client.env.git.authorEmail,
            'commit-committer-name': client.env.git.committerName,
            'commit-committer-email': client.env.git.committerEmail,
            'commit-message': client.env.git.message,
            'pull-request-number': client.env.pullRequest,
            'parallel-nonce': client.env.parallel.nonce,
            'parallel-total-shards': client.env.parallel.total,
            'cli-start-time': null,
            'testhub-build-uuid': client.env.testhubBuildUuid,
            'testhub-build-run-id': client.env.testhubBuildRunId,
            source: 'bstack_sdk_created',
            partial: client.env.partial,
            tags: []
          }
        }));
    });
  });

  describe('#getBuild()', () => {
    it('throws when missing a build id', async () => {
      await expectAsync(client.getBuild())
        .toBeRejectedWithError('Missing build ID');
    });

    it('gets build data', async () => {
      api.reply('/builds/100', () => [200, { data: '<<build-data>>' }]);
      await expectAsync(client.getBuild(100)).toBeResolvedTo({ data: '<<build-data>>' });
    });
  });

  describe('#getComparisonDetails()', () => {
    it('throws when missing a comparison id', async () => {
      await expectAsync(client.getComparisonDetails())
        .toBeRejectedWithError('Missing comparison ID');
    });

    it('gets comparison data', async () => {
      api.reply('/comparisons/101?sync=true&response_format=sync-cli', () => [200, { data: '<<comparison-data>>' }]);
      await expectAsync(client.getComparisonDetails(101)).toBeResolvedTo({ data: '<<comparison-data>>' });
    });

    it('gets comparison data throw 403', async () => {
      api.reply('/comparisons/102?sync=true&response_format=sync-cli', () => [403, { data: '<<comparison-data>>' }]);
      await expectAsync(client.getComparisonDetails(102)).toBeRejectedWithError('Unable to retrieve snapshot details with write access token. Kindly use a full access token for retrieving snapshot details with Synchronous CLI.');
    });

    it('gets comparison data throw 500', async () => {
      api.reply('/comparisons/104?sync=true&response_format=sync-cli', () => [500, { error: '<<comparison-data-failure>>' }]);
      await expectAsync(client.getComparisonDetails(104)).toBeRejectedWithError('500 \n{"error":"<<comparison-data-failure>>"}');
    });
  });

  describe('#getSnapshotDetails()', () => {
    it('throws when missing a snapshot id', async () => {
      await expectAsync(client.getSnapshotDetails())
        .toBeRejectedWithError('Missing snapshot ID');
    });

    it('gets snapshot data', async () => {
      api.reply('/snapshots/100?sync=true&response_format=sync-cli', () => [200, { data: '<<snapshot-data>>' }]);
      await expectAsync(client.getSnapshotDetails(100)).toBeResolvedTo({ data: '<<snapshot-data>>' });
    });

    it('gets snapshot data throw 403', async () => {
      api.reply('/snapshots/102?sync=true&response_format=sync-cli', () => [403, { data: '<<comparison-data>>' }]);
      await expectAsync(client.getSnapshotDetails(102)).toBeRejectedWithError('Unable to retrieve snapshot details with write access token. Kindly use a full access token for retrieving snapshot details with Synchronous CLI.');
    });

    it('gets snapshot data throw 500', async () => {
      api.reply('/snapshots/104?sync=true&response_format=sync-cli', () => [500, { error: '<<snapshot-data-failure>>' }]);
      await expectAsync(client.getSnapshotDetails(104)).toBeRejectedWithError('500 \n{"error":"<<snapshot-data-failure>>"}');
    });
  });

  describe('#getStatus()', () => {
    it('throws when invalid type passed', async () => {
      await expectAsync(client.getStatus('snap', [1]))
        .toBeRejectedWithError('Invalid type passed');
    });

    it('gets snapshot data', async () => {
      api.reply('/job_status?sync=true&type=snapshot&id=1,2', () => [200, { data: '<<status-data-snapshot>>' }]);
      api.reply('/job_status?sync=true&type=comparison&id=3,4', () => [200, { data: '<<status-data-comparison>>' }]);
      api.reply('/job_status?sync=true&type=comparison&id=5', () => [200, { data: '<<status-data-comparison-2>>' }]);
      await expectAsync(client.getStatus('snapshot', [1, 2])).toBeResolvedTo({ data: '<<status-data-snapshot>>' });
      await expectAsync(client.getStatus('comparison', [3, 4])).toBeResolvedTo({ data: '<<status-data-comparison>>' });
      await expectAsync(client.getStatus('comparison', [5])).toBeResolvedTo({ data: '<<status-data-comparison-2>>' });
    });
  });

  describe('#getDeviceDetails()', () => {
    it('in case of error return []', async () => {
      api.reply('/discovery/device-details', () => [500]);
      await expectAsync(client.getDeviceDetails()).toBeResolvedTo([]);
    });

    it('gets device details', async () => {
      api.reply('/discovery/device-details', () => [200, { data: ['<<device-data-without-build-id>>'] }]);
      api.reply('/discovery/device-details?build_id=123', () => [200, { data: ['<<device-data-with-build-id>>'] }]);
      await expectAsync(client.getDeviceDetails()).toBeResolvedTo(['<<device-data-without-build-id>>']);
      await expectAsync(client.getDeviceDetails(123)).toBeResolvedTo(['<<device-data-with-build-id>>']);
    });
  });

  describe('#getBuilds()', () => {
    it('throws when missing a project path', async () => {
      await expectAsync(client.getBuilds())
        .toBeRejectedWithError('Missing project path');
    });

    it('throws when using an invalid project path', async () => {
      await expectAsync(client.getBuilds('test'))
        .toBeRejectedWithError('Invalid project path. Expected "org/project" but received "test"');
    });

    it('gets project builds data', async () => {
      api.reply('/projects/foo/bar/builds', () => [200, { data: ['<<build-data>>'] }]);
      await expectAsync(client.getBuilds('foo/bar')).toBeResolvedTo({ data: ['<<build-data>>'] });
    });

    it('gets project builds data filtered by a sha', async () => {
      api.reply('/projects/foo/bar/builds?filter[sha]=test-sha', () => (
        [200, { data: ['<<build-data>>'] }]
      ));

      await expectAsync(client.getBuilds('foo/bar', { sha: 'test-sha' }))
        .toBeResolvedTo({ data: ['<<build-data>>'] });
    });

    it('gets project builds data filtered by state, branch, and shas', async () => {
      api.reply('/projects/foo/bar/builds?' + [
        'filter[branch]=master',
        'filter[state]=finished',
        'filter[shas][]=test-sha-1',
        'filter[shas][]=test-sha-2'
      ].join('&'), () => [200, {
        data: ['<<build-data>>']
      }]);

      await expectAsync(
        client.getBuilds('foo/bar', {
          branch: 'master',
          state: 'finished',
          shas: ['test-sha-1', 'test-sha-2']
        })
      ).toBeResolvedTo({
        data: ['<<build-data>>']
      });
    });
  });

  describe('#waitForBuild()', () => {
    it('throws when missing a project or build', () => {
      expect(() => client.waitForBuild({ commit: null }))
        .toThrowError('Missing project path or build ID');
    });

    it('throws when missing a project with a commit', () => {
      expect(() => client.waitForBuild({ commit: '...' }))
        .toThrowError('Missing project path for commit');
    });

    it('throws when missing a commit for a project', () => {
      Object.defineProperty(client.env, 'git', { value: { sha: null } });

      expect(() => client.waitForBuild({ project: 'foo/bar' }))
        .toThrowError('Missing build commit');
    });

    it('throws when using an invalid project path', () => {
      expect(() => client.waitForBuild({ commit: '...', project: 'test' }))
        .toThrowError('Invalid project path. Expected "org/project" but received "test"');
    });

    it('warns when interval is less than 1000ms', async () => {
      api
        .reply('/builds/123', () => [200, {
          data: { attributes: { state: 'finished' } }
        }]);

      await client.waitForBuild({ build: '123', interval: 50 });
      expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:client] Ignoring interval since it cannot be less than 1000ms.']));
    });

    it('invokes the callback when data changes while waiting', async () => {
      let progress = 0;

      api
        .reply('/builds/123', () => [200, {
          data: { attributes: { state: 'processing' } }
        }])
        .reply('/builds/123', () => [200, {
          data: { attributes: { state: 'processing' } }
        }])
        .reply('/builds/123', () => [200, {
          data: { attributes: { state: 'finished' } }
        }]);

      await client.waitForBuild({
        build: '123',
        interval: 50
      }, () => progress++);

      expect(progress).toEqual(2);
    });

    it('throws when no update happens within the timeout', async () => {
      api.reply('/builds/123', () => [200, {
        data: { attributes: { state: 'processing' } }
      }]);

      await expectAsync(client.waitForBuild({ build: '123', timeout: 1500, interval: 50 }))
        .toBeRejectedWithError('Timeout exceeded with no updates');
    });

    it('throws when no build is found within the timeout', async () => {
      api.reply('/projects/foo/bar/builds?filter[sha]=sha123', () => [200, { data: [] }]);

      await expectAsync(client.waitForBuild({
        project: 'foo/bar',
        commit: 'sha123',
        timeout: 500,
        interval: 50
      })).toBeRejectedWithError('Build not found');
    });

    it('resolves when the build completes', async () => {
      api
        .reply('/builds/123', () => [200, {
          data: { attributes: { state: 'processing' } }
        }])
        .reply('/builds/123', () => [200, {
          data: { attributes: { state: 'finished' } }
        }]);

      await expectAsync(client.waitForBuild({ build: '123', interval: 50 }))
        .toBeResolvedTo({ data: { attributes: { state: 'finished' } } });
    });

    it('resolves when the build matching a commit revision completes', async () => {
      mockgit().and.returnValue('COMMIT_SHA:commit-sha');

      api
        .reply('/projects/foo/bar/builds?filter[sha]=commit-sha', () => [200, {
          data: [{ attributes: { state: 'processing' } }]
        }])
        .reply('/projects/foo/bar/builds?filter[sha]=commit-sha', () => [200, {
          data: [{ attributes: { state: 'finished' } }]
        }]);

      await expectAsync(client.waitForBuild({ project: 'foo/bar', interval: 50 }))
        .toBeResolvedTo({ data: { attributes: { state: 'finished' } } });
    });

    it('defaults to the provided commit when revision parsing fails', async () => {
      mockgit().and.throwError(new Error('test'));

      api.reply('/projects/foo/bar/builds?filter[sha]=abcdef', () => [200, {
        data: [{ attributes: { state: 'finished' } }]
      }]);

      await expectAsync(client.waitForBuild({ project: 'foo/bar', commit: 'abcdef' }))
        .toBeResolvedTo({ data: { attributes: { state: 'finished' } } });
    });
  });

  describe('#finalizeBuild()', () => {
    it('throws when missing a build id', async () => {
      await expectAsync(client.finalizeBuild())
        .toBeRejectedWithError('Missing build ID');
      await expectAsync(client.finalizeBuild({ all: true }))
        .toBeRejectedWithError('Invalid build ID');
    });

    it('finalizes the build', async () => {
      await expectAsync(client.finalizeBuild(123)).toBeResolved();
      expect(api.requests['/builds/123/finalize']).toBeDefined();
    });

    it('can finalize all shards of a build', async () => {
      await expectAsync(client.finalizeBuild(123, { all: true })).toBeResolved();
      expect(api.requests['/builds/123/finalize?all-shards=true']).toBeDefined();
    });
  });

  describe('#uploadResource()', () => {
    it('throws when missing a build id', async () => {
      await expectAsync(client.uploadResource())
        .toBeRejectedWithError('Missing build ID');
      await expectAsync(client.uploadResource({}))
        .toBeRejectedWithError('Invalid build ID');
    });

    it('uploads a resource for a build', async () => {
      await expectAsync(client.uploadResource(123, { content: 'foo', url: 'foo/bar' })).toBeResolved();
      expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:client] Uploading 4B resource: foo/bar']));

      expect(api.requests['/builds/123/resources'][0].body).toEqual({
        data: {
          type: 'resources',
          id: sha256hash('foo'),
          attributes: {
            'base64-content': base64encode('foo')
          }
        }
      });
    });

    it('can upload a resource from a local path', async () => {
      spyOn(fs.promises, 'readFile').and.callFake(async p => `contents of ${p}`);

      await expectAsync(client.uploadResource(123, {
        sha: 'foo-sha',
        filepath: 'foo/bar'
      })).toBeResolved();

      expect(api.requests['/builds/123/resources'][0].body).toEqual({
        data: {
          type: 'resources',
          id: 'foo-sha',
          attributes: {
            'base64-content': base64encode('contents of foo/bar')
          }
        }
      });
    });

    it('can upload a resource from a local path in GZIP format', async () => {
      process.env.PERCY_GZIP = true;

      spyOn(fs.promises, 'readFile').and.callFake(async p => `contents of ${p}`);

      await expectAsync(client.uploadResource(123, {
        sha: 'foo-sha',
        filepath: 'foo/bar'
      })).toBeResolved();

      expect(api.requests['/builds/123/resources'][0].body).toEqual({
        data: {
          type: 'resources',
          id: 'foo-sha',
          attributes: {
            'base64-content': base64encode(Pako.gzip('contents of foo/bar'))
          }
        }
      });
    });
  });

  describe('#uploadResources()', () => {
    it('throws when missing a build id', async () => {
      await expectAsync(client.uploadResources())
        .toBeRejectedWithError('Missing build ID');
      await expectAsync(client.uploadResources([]))
        .toBeRejectedWithError('Invalid build ID');
    });

    it('does nothing when no resources are provided', async () => {
      await expectAsync(client.uploadResources(123, [])).toBeResolvedTo([]);
    });

    it('uploads multiple resources two at a time', async () => {
      let content = 'foo';

      api.reply('/builds/123/resources', async () => {
        let result = { content };
        setTimeout(() => (content = 'bar'), 10);
        await new Promise(r => setTimeout(r, 20));
        return [201, result];
      });

      spyOn(fs.promises, 'readFile').and.resolveTo(content);

      await expectAsync(client.uploadResources(123, [
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' }
      ])).toBeResolvedTo([
        { content: 'foo' },
        { content: 'foo' },
        { content: 'bar' },
        { content: 'bar' }
      ]);
    });

    it('throws any errors from uploading', async () => {
      spyOn(fs.promises, 'readFile').and.rejectWith(new Error());

      await expectAsync(client.uploadResources(123, [
        { filepath: 'foo/bar' }
      ])).toBeRejectedWithError();
    });
  });

  describe('#createSnapshot()', () => {
    it('throws when missing a build id', async () => {
      await expectAsync(client.createSnapshot())
        .toBeRejectedWithError('Missing build ID');
      await expectAsync(client.createSnapshot({}))
        .toBeRejectedWithError('Invalid build ID');
    });

    it('creates a snapshot', async () => {
      spyOn(fs.promises, 'readFile')
        .withArgs('foo/bar').and.resolveTo('bar');

      await expectAsync(client.createSnapshot(123, {
        name: 'snapfoo',
        widths: [1000],
        scope: '#main',
        sync: true,
        testCase: 'foo test case',
        labels: 'tag 1,tag 2',
        scopeOptions: { scroll: true },
        minHeight: 1000,
        enableJavaScript: true,
        regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'ignore' }],
        algorithm: 'layout',
        enableLayout: true,
        clientInfo: 'sdk/info',
        environmentInfo: 'sdk/env',
        thTestCaseExecutionId: 'random-uuid',
        resources: [{
          url: '/foo',
          content: 'foo',
          mimetype: 'text/html',
          widths: [1000],
          root: true
        }, {
          url: '/bar',
          filepath: 'foo/bar',
          mimetype: 'image/png'
        }]
      })).toBeResolved();

      expect(api.requests['/builds/123/snapshots'][0].headers).toEqual(
        jasmine.objectContaining({
          'User-Agent': jasmine.stringMatching(
            /^Percy\/v1 @percy\/client\/\S+ sdk\/info \(sdk\/env; node\/v[\d.]+.*\)$/
          )
        })
      );

      const expectedRegions = [
        { elementSelector: { elementCSS: '#test' }, algorithm: 'ignore' },
        { elementSelector: { fullpage: true }, algorithm: 'layout' }
      ];
      expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: 'snapfoo',
            widths: [1000],
            scope: '#main',
            regions: expectedRegions,
            sync: true,
            'test-case': 'foo test case',
            tags: [{ id: null, name: 'tag 1' }, { id: null, name: 'tag 2' }],
            'minimum-height': 1000,
            'scope-options': { scroll: true },
            'enable-javascript': true,
            'enable-layout': true,
            'th-test-case-execution-id': 'random-uuid',
            browsers: null
          },
          relationships: {
            resources: {
              data: [{
                type: 'resources',
                id: sha256hash('foo'),
                attributes: {
                  'resource-url': '/foo',
                  mimetype: 'text/html',
                  'for-widths': [1000],
                  'is-root': true
                }
              }, {
                type: 'resources',
                id: sha256hash('bar'),
                attributes: {
                  'resource-url': '/bar',
                  mimetype: 'image/png',
                  'for-widths': null,
                  'is-root': null
                }
              }]
            }
          }
        }
      });
    });

    describe('with browsers', () => {
      it('creates a snapshot', async () => {
        spyOn(fs.promises, 'readFile')
          .withArgs('foo/bar').and.resolveTo('bar');

        await expectAsync(client.createSnapshot(123, {
          name: 'snapfoo',
          widths: [1000],
          scope: '#main',
          sync: true,
          testCase: 'foo test case',
          labels: 'tag 1,tag 2',
          scopeOptions: { scroll: true },
          minHeight: 1000,
          enableJavaScript: true,
          regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'ignore' }],
          algorithm: 'layout',
          enableLayout: true,
          clientInfo: 'sdk/info',
          environmentInfo: 'sdk/env',
          thTestCaseExecutionId: 'random-uuid',
          browsers: ['chrome', 'firefox', 'safari-on-iphone'],
          resources: [{
            url: '/foo',
            content: 'foo',
            mimetype: 'text/html',
            widths: [1000],
            root: true
          }, {
            url: '/bar',
            filepath: 'foo/bar',
            mimetype: 'image/png'
          }]
        })).toBeResolved();

        expect(api.requests['/builds/123/snapshots'][0].headers).toEqual(
          jasmine.objectContaining({
            'User-Agent': jasmine.stringMatching(
              /^Percy\/v1 @percy\/client\/\S+ sdk\/info \(sdk\/env; node\/v[\d.]+.*\)$/
            )
          })
        );

        const expectedRegions = [
          { elementSelector: { elementCSS: '#test' }, algorithm: 'ignore' },
          { elementSelector: { fullpage: true }, algorithm: 'layout' }
        ];
        expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
          data: {
            type: 'snapshots',
            attributes: {
              name: 'snapfoo',
              widths: [1000],
              scope: '#main',
              regions: expectedRegions,
              sync: true,
              'test-case': 'foo test case',
              tags: [{ id: null, name: 'tag 1' }, { id: null, name: 'tag 2' }],
              'minimum-height': 1000,
              'scope-options': { scroll: true },
              'enable-javascript': true,
              'enable-layout': true,
              'th-test-case-execution-id': 'random-uuid',
              browsers: ['chrome', 'firefox', 'safari_on_iphone']
            },
            relationships: {
              resources: {
                data: [{
                  type: 'resources',
                  id: sha256hash('foo'),
                  attributes: {
                    'resource-url': '/foo',
                    mimetype: 'text/html',
                    'for-widths': [1000],
                    'is-root': true
                  }
                }, {
                  type: 'resources',
                  id: sha256hash('bar'),
                  attributes: {
                    'resource-url': '/bar',
                    mimetype: 'image/png',
                    'for-widths': null,
                    'is-root': null
                  }
                }]
              }
            }
          }
        });
      });
    });

    it('falls back to null attributes for various properties', async () => {
      await expectAsync(
        client.createSnapshot(123, { resources: [{ sha: 'sha' }] })
      ).toBeResolved();

      expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: null,
            widths: null,
            scope: null,
            sync: false,
            'test-case': null,
            tags: [],
            'scope-options': {},
            'minimum-height': null,
            'enable-javascript': null,
            'enable-layout': false,
            regions: null,
            'th-test-case-execution-id': null,
            browsers: null
          },
          relationships: {
            resources: {
              data: [{
                type: 'resources',
                id: 'sha',
                attributes: {
                  'resource-url': null,
                  'for-widths': null,
                  'is-root': null,
                  mimetype: null
                }
              }]
            }
          }
        }
      });
    });
  });

  describe('#finalizeSnapshot()', () => {
    it('throws when missing a snapshot id', async () => {
      await expectAsync(client.finalizeSnapshot())
        .toBeRejectedWithError('Missing snapshot ID');
    });

    it('finalizes a snapshot', async () => {
      await expectAsync(client.finalizeSnapshot(123)).toBeResolved();
      expect(api.requests['/snapshots/123/finalize']).toBeDefined();
    });
  });

  describe('#sendSnapshot()', () => {
    let testDOM = `
      <!doctype html>
      <html>
        <head></head>
        <body></body>
      </html>
    `;

    it('creates a snapshot', async () => {
      await expectAsync(
        client.sendSnapshot(123, {
          name: 'test snapshot name',
          sync: true,
          resources: [{
            sha: sha256hash(testDOM),
            mimetype: 'text/html',
            content: testDOM,
            widths: [1000],
            root: true
          }]
        })
      ).toBeResolved();

      expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: 'test snapshot name',
            scope: null,
            sync: true,
            'test-case': null,
            tags: [],
            'scope-options': {},
            'enable-javascript': null,
            'minimum-height': null,
            widths: null,
            regions: null,
            'enable-layout': false,
            'th-test-case-execution-id': null,
            browsers: null
          },
          relationships: {
            resources: {
              data: [{
                type: 'resources',
                id: sha256hash(testDOM),
                attributes: {
                  mimetype: 'text/html',
                  'resource-url': null,
                  'for-widths': [1000],
                  'is-root': true
                }
              }]
            }
          }
        }
      });
    });

    it('uploads missing resources', async () => {
      await expectAsync(
        client.sendSnapshot(123, {
          name: 'test snapshot name',
          resources: [{
            sha: sha256hash(testDOM),
            mimetype: 'text/html',
            content: testDOM,
            root: true
          }]
        })
      ).toBeResolved();

      expect(api.requests['/builds/123/resources'][0].body).toEqual({
        data: {
          type: 'resources',
          id: sha256hash(testDOM),
          attributes: {
            'base64-content': base64encode(testDOM)
          }
        }
      });
    });

    it('finalizes a snapshot', async () => {
      await expectAsync(client.sendSnapshot(123, { name: 'test snapshot name' })).toBeResolved();
      expect(api.requests['/snapshots/4567/finalize']).toBeDefined();
    });
  });

  describe('#createComparison()', () => {
    it('throws when missing a snapshot id', async () => {
      await expectAsync(client.createComparison())
        .toBeRejectedWithError('Missing snapshot ID');
    });

    it('creates a comparison', async () => {
      spyOn(fs.promises, 'readFile')
        .withArgs('foo/bar').and.resolveTo('bar');

      let tile1Content = 'screenshot';
      let ignoredElementsData = {
        ignoreElementsData: [
          {
            selector: 'xpaths',
            'co-ordinates': {
              top: 1042,
              bottom: 1147,
              left: 108,
              right: 972
            }
          },
          {
            selector: 'appiumWebElement',
            'co-ordinates': {
              top: 1199,
              bottom: 1304,
              left: 108,
              right: 972
            }
          }
        ]
      };
      let consideredElementsData = {
        considerElementsData: [
          {
            selector: 'xpaths',
            'co-ordinates': {
              top: 300,
              bottom: 480,
              left: 108,
              right: 220
            }
          }
        ]
      };

      await expectAsync(client.createComparison(4567, {
        tag: {
          name: 'tagfoo',
          width: 748,
          height: 1024,
          osName: 'fooOS',
          osVersion: '0.1.0',
          orientation: 'portrait',
          browserName: 'chrome',
          browserVersion: '111.0.0',
          resolution: '1980 x 1080'
        },
        tiles: [{
          statusBarHeight: 40,
          navBarHeight: 30,
          headerHeight: 20,
          footerHeight: 50,
          fullscreen: false,
          content: Buffer.from(tile1Content).toString('base64')
        }, {
          statusBarHeight: 40,
          navBarHeight: 30,
          headerHeight: 20,
          footerHeight: 50,
          fullscreen: true,
          filepath: 'foo/bar'
        }, {
          statusBarHeight: 40,
          navBarHeight: 30,
          headerHeight: 20,
          footerHeight: 50,
          fullscreen: true,
          sha: sha256hash('somesha')
        }],
        externalDebugUrl: 'http://debug.localhost',
        sync: true,
        ignoredElementsData: ignoredElementsData,
        consideredElementsData: consideredElementsData,
        domInfoSha: 'abcd=',
        regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'layout' }],
        algorithm: 'intelliignore',
        algorithmConfiguration: { diffSensitivity: 2 },
        metadata: {
          windowHeight: 1947,
          screenshotType: 'singlepage'
        },
        elementSelectorsData: {
          '#button-id': {
            success: true,
            top: 300,
            left: 100,
            bottom: 350,
            right: 250,
            message: 'Found',
            stacktrace: null
          }
        }
      })).toBeResolved();

      const expectedRegions = [
        { elementSelector: { elementCSS: '#test' }, algorithm: 'layout' },
        {
          elementSelector: { fullpage: true },
          algorithm: 'intelliignore',
          configuration: { diffSensitivity: 2 }
        }
      ];
      expect(api.requests['/snapshots/4567/comparisons'][0].body).toEqual({
        data: {
          type: 'comparisons',
          attributes: {
            'external-debug-url': 'http://debug.localhost',
            'ignore-elements-data': ignoredElementsData,
            'consider-elements-data': consideredElementsData,
            'dom-info-sha': 'abcd=',
            'element-selectors-data': {
              '#button-id': {
                success: true,
                top: 300,
                left: 100,
                bottom: 350,
                right: 250,
                message: 'Found',
                stacktrace: null
              }
            },
            regions: expectedRegions,
            sync: true,
            metadata: {
              windowHeight: 1947,
              screenshotType: 'singlepage'
            }
          },
          relationships: {
            tag: {
              data: {
                type: 'tag',
                attributes: {
                  name: 'tagfoo',
                  width: 748,
                  height: 1024,
                  'os-name': 'fooOS',
                  'os-version': '0.1.0',
                  orientation: 'portrait',
                  'browser-name': 'chrome',
                  'browser-version': '111.0.0',
                  resolution: '1980 x 1080',
                  'percy-browser-custom-name': null
                }
              }
            },
            tiles: {
              data: [{
                type: 'tiles',
                attributes: {
                  sha: sha256hash(Buffer.from(tile1Content)),
                  'status-bar-height': 40,
                  'nav-bar-height': 30,
                  'header-height': 20,
                  'footer-height': 50,
                  fullscreen: null
                }
              }, {
                type: 'tiles',
                attributes: {
                  sha: sha256hash('bar'),
                  'status-bar-height': 40,
                  'nav-bar-height': 30,
                  'header-height': 20,
                  'footer-height': 50,
                  fullscreen: true
                }
              }, {
                type: 'tiles',
                attributes: {
                  sha: sha256hash('somesha'),
                  'status-bar-height': 40,
                  'nav-bar-height': 30,
                  'header-height': 20,
                  'footer-height': 50,
                  fullscreen: true
                }
              }]
            }
          }
        }
      });
    });

    it('creates a comparison when algorithm is not passed', async () => {
      spyOn(fs.promises, 'readFile')
        .withArgs('foo/bar').and.resolveTo('bar');

      let tile1Content = 'screenshot';
      let ignoredElementsData = {
        ignoreElementsData: [
          {
            selector: 'xpaths',
            'co-ordinates': {
              top: 1042,
              bottom: 1147,
              left: 108,
              right: 972
            }
          },
          {
            selector: 'appiumWebElement',
            'co-ordinates': {
              top: 1199,
              bottom: 1304,
              left: 108,
              right: 972
            }
          }
        ]
      };
      let consideredElementsData = {
        considerElementsData: [
          {
            selector: 'xpaths',
            'co-ordinates': {
              top: 300,
              bottom: 480,
              left: 108,
              right: 220
            }
          }
        ]
      };

      await expectAsync(client.createComparison(4567, {
        tag: {
          name: 'tagfoo',
          width: 748,
          height: 1024,
          osName: 'fooOS',
          osVersion: '0.1.0',
          orientation: 'portrait',
          browserName: 'chrome',
          browserVersion: '111.0.0',
          resolution: '1980 x 1080'
        },
        tiles: [{
          statusBarHeight: 40,
          navBarHeight: 30,
          headerHeight: 20,
          footerHeight: 50,
          fullscreen: false,
          content: Buffer.from(tile1Content).toString('base64')
        }, {
          statusBarHeight: 40,
          navBarHeight: 30,
          headerHeight: 20,
          footerHeight: 50,
          fullscreen: true,
          filepath: 'foo/bar'
        }, {
          statusBarHeight: 40,
          navBarHeight: 30,
          headerHeight: 20,
          footerHeight: 50,
          fullscreen: true,
          sha: sha256hash('somesha')
        }],
        externalDebugUrl: 'http://debug.localhost',
        sync: true,
        ignoredElementsData: ignoredElementsData,
        consideredElementsData: consideredElementsData,
        domInfoSha: 'abcd=',
        regions: [{ elementSelector: { elementCSS: '#test' }, algorithm: 'layout' }],
        metadata: {
          windowHeight: 1947,
          screenshotType: 'singlepage'
        }
      })).toBeResolved();

      const expectedRegions = [
        { elementSelector: { elementCSS: '#test' }, algorithm: 'layout' }
      ];
      expect(api.requests['/snapshots/4567/comparisons'][0].body).toEqual({
        data: {
          type: 'comparisons',
          attributes: {
            'external-debug-url': 'http://debug.localhost',
            'ignore-elements-data': ignoredElementsData,
            'consider-elements-data': consideredElementsData,
            'dom-info-sha': 'abcd=',
            'element-selectors-data': null,
            regions: expectedRegions,
            sync: true,
            metadata: {
              windowHeight: 1947,
              screenshotType: 'singlepage'
            }
          },
          relationships: {
            tag: {
              data: {
                type: 'tag',
                attributes: {
                  name: 'tagfoo',
                  width: 748,
                  height: 1024,
                  'os-name': 'fooOS',
                  'os-version': '0.1.0',
                  orientation: 'portrait',
                  'browser-name': 'chrome',
                  'browser-version': '111.0.0',
                  resolution: '1980 x 1080',
                  'percy-browser-custom-name': null
                }
              }
            },
            tiles: {
              data: [{
                type: 'tiles',
                attributes: {
                  sha: sha256hash(Buffer.from(tile1Content)),
                  'status-bar-height': 40,
                  'nav-bar-height': 30,
                  'header-height': 20,
                  'footer-height': 50,
                  fullscreen: null
                }
              }, {
                type: 'tiles',
                attributes: {
                  sha: sha256hash('bar'),
                  'status-bar-height': 40,
                  'nav-bar-height': 30,
                  'header-height': 20,
                  'footer-height': 50,
                  fullscreen: true
                }
              }, {
                type: 'tiles',
                attributes: {
                  sha: sha256hash('somesha'),
                  'status-bar-height': 40,
                  'nav-bar-height': 30,
                  'header-height': 20,
                  'footer-height': 50,
                  fullscreen: true
                }
              }]
            }
          }
        }
      });
    });

    it('falls back to null attributes for various properties', async () => {
      await expectAsync(
        client.createComparison(4567, { tag: {}, tiles: [{}] })
      ).toBeResolved();

      expect(api.requests['/snapshots/4567/comparisons'][0].body).toEqual({
        data: {
          type: 'comparisons',
          attributes: {
            'external-debug-url': null,
            'ignore-elements-data': null,
            'consider-elements-data': null,
            'element-selectors-data': null,
            'dom-info-sha': null,
            sync: false,
            regions: null,
            metadata: null
          },
          relationships: {
            tag: {
              data: {
                type: 'tag',
                attributes: {
                  name: null,
                  width: null,
                  height: null,
                  'os-name': null,
                  'os-version': null,
                  orientation: null,
                  'browser-name': null,
                  'browser-version': null,
                  resolution: null,
                  'percy-browser-custom-name': null
                }
              }
            },
            tiles: {
              data: [{
                type: 'tiles',
                attributes: {
                  'status-bar-height': null,
                  'nav-bar-height': null,
                  'header-height': null,
                  'footer-height': null,
                  fullscreen: null
                }
              }]
            }
          }
        }
      });
    });

    it('includes percy-browser-custom-name when provided in tag', async () => {
      await expectAsync(client.createComparison(4567, {
        tag: {
          name: 'custom-tag',
          width: 1920,
          height: 1080,
          osName: 'Windows',
          osVersion: '11',
          orientation: 'landscape',
          browserName: 'chrome',
          browserVersion: '120',
          resolution: '1920 x 1080',
          percyBrowserCustomName: 'My Custom Browser Name'
        },
        tiles: [{ content: 'test' }]
      })).toBeResolved();

      expect(api.requests['/snapshots/4567/comparisons'][0].body.data.relationships.tag.data.attributes).toEqual({
        name: 'custom-tag',
        width: 1920,
        height: 1080,
        'os-name': 'Windows',
        'os-version': '11',
        orientation: 'landscape',
        'browser-name': 'chrome',
        'browser-version': '120',
        resolution: '1920 x 1080',
        'percy-browser-custom-name': 'My Custom Browser Name'
      });
    });

    it('includes elementSelectorsData when provided', async () => {
      const elementSelectorsData = {
        '#test-id': {
          success: true,
          top: 100,
          left: 100,
          bottom: 200,
          right: 200,
          message: 'Found',
          stacktrace: null
        }
      };

      await expectAsync(client.createComparison(4567, {
        tag: { name: 'tag' },
        tiles: [{ content: 'test' }],
        elementSelectorsData
      })).toBeResolved();

      expect(api.requests['/snapshots/4567/comparisons'][0].body.data.attributes['element-selectors-data']).toEqual(elementSelectorsData);
    });

    it('throws unknown property in invalid comparison json', () => {
      spyOn(fs.promises, 'readFile')
        .withArgs('foo/bar').and.resolveTo('bar');

      const comparison = {
        name: 'test',
        tag: {
          name: 'Samsung Galaxy S22',
          osName: 'Android',
          osVersion: '12',
          width: 1080,
          height: 2115,
          orientation: 'portrait',
          browserName: 'chrome',
          browserVersion: 'Samsung Galaxy S22',
          resolution: '1080 x 2340'
        },
        tiles: [
          {
            statusBarHeight: 0,
            navBarHeight: 0,
            headerHeight: 0,
            footerHeight: 168,
            fullscreen: false,
            sha: 'abcd'
          }],
        externalDebugUrl: 'https://automate.browserstack.com/builds/acs',
        metadata: {
          windowHeight: 1947,
          screenshotType: 'fullpage',
          abc: 123
        }
      };

      PercyConfig.addSchema(CoreConfig.schemas);
      const errors = PercyConfig.validate(comparison, '/comparison');
      expect(errors).not.toBe(null);
      expect(errors.length).toBe(1);
      expect(errors[0].path).toBe('metadata.abc');
      expect(errors[0].message).toBe('unknown property');
    });
  });

  describe('#uploadComparisonTile()', () => {
    it('throws when missing a comparison id', async () => {
      await expectAsync(client.uploadComparisonTile())
        .toBeRejectedWithError('Missing comparison ID');
    });

    it('uploads a tile for a comparison', async () => {
      await expectAsync(
        client.uploadComparisonTile(891011, { content: 'foo', index: 3 })
      ).toBeResolved();

      expect(logger.stderr).toEqual(jasmine.arrayContaining(['[percy:client] Uploading 4B comparison tile: 4/1 (891011)...']));

      expect(api.requests['/comparisons/891011/tiles'][0].body).toEqual({
        data: {
          type: 'tiles',
          attributes: {
            'base64-content': base64encode('foo'),
            index: 3
          }
        }
      });
    });

    it('can upload a tile from a local path', async () => {
      spyOn(fs.promises, 'readFile').and.callFake(async p => `contents of ${p}`);

      await expectAsync(
        client.uploadComparisonTile(891011, { filepath: 'foo/bar' })
      ).toBeResolved();

      expect(api.requests['/comparisons/891011/tiles'][0].body).toEqual({
        data: {
          type: 'tiles',
          attributes: {
            'base64-content': base64encode('contents of foo/bar'),
            index: 0
          }
        }
      });
    });

    it('does not read file if content is passed', async () => {
      let readSpy = spyOn(fs.promises, 'readFile');

      let buffer = Buffer.from('screenshot');
      await expectAsync(
        client.uploadComparisonTile(891011, { filepath: 'foo/bar', content: buffer })
      ).toBeResolved();

      expect(api.requests['/comparisons/891011/tiles'][0].body).toEqual({
        data: {
          type: 'tiles',
          attributes: {
            'base64-content': base64encode(buffer),
            index: 0
          }
        }
      });
      expect(readSpy).not.toHaveBeenCalled();
    });
  });

  describe('#uploadComparisonTiles()', () => {
    let originalTimeout;
    beforeEach(() => {
      originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
      jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    afterEach(() => {
      jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    });

    it('throws when missing a build id', async () => {
      await expectAsync(client.uploadComparisonTiles())
        .toBeRejectedWithError('Missing comparison ID');
    });

    it('does nothing when no tiles are provided', async () => {
      await expectAsync(client.uploadComparisonTiles(891011, [])).toBeResolvedTo([]);
    });

    it('uploads multiple tiles two at a time', async () => {
      let content = 'foo';

      api.reply('/comparisons/891011/tiles', async () => {
        let result = { content };
        setTimeout(() => (content = 'bar'), 10);
        await new Promise(r => setTimeout(r, 20));
        return [201, result];
      });

      spyOn(fs.promises, 'readFile').and.resolveTo(content);

      await expectAsync(client.uploadComparisonTiles(891011, [
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' }
      ])).toBeResolvedTo([
        { content: 'foo' },
        { content: 'foo' },
        { content: 'bar' },
        { content: 'bar' }
      ]);
    });

    it('throws any errors from uploading', async () => {
      spyOn(fs.promises, 'readFile').and.rejectWith(new Error());

      await expectAsync(client.uploadComparisonTiles(123, [
        { filepath: 'foo/bar' }
      ])).toBeRejectedWithError();
    });

    it('returns true if tile is verified', async () => {
      api.reply('/comparisons/891011/tiles/verify', async () => {
        return [200, 'success'];
      });

      await expectAsync(client.uploadComparisonTiles(891011, [
        { sha: sha256hash('foo') }
      ])).toBeResolvedTo([
        true
      ]);
    });

    it('throws error if tile is not verified', async () => {
      api.reply('/comparisons/891011/tiles/verify', async () => {
        return [400, 'failure'];
      });

      await expectAsync(client.uploadComparisonTiles(891011, [
        { sha: sha256hash('foo') }
      ])).toBeRejectedWithError('Uploading comparison tile failed');
    });

    it('throws any errors from verifying', async () => {
      api.reply('/comparisons/891011/tiles/verify', async () => {
        return [409, 'Not found'];
      });

      await expectAsync(client.uploadComparisonTiles(891011, [
        { sha: sha256hash('foo') }
      ])).toBeRejectedWithError();
    });
  });

  describe('#verifyComparisonTile()', () => {
    it('throws when missing a comparison id', async () => {
      await expectAsync(client.verifyComparisonTile())
        .toBeRejectedWithError('Missing comparison ID');
    });

    it('verify a comparison tile', async () => {
      await expectAsync(client.verifyComparisonTile(123, 'sha')).toBeResolved();

      expect(api.requests['/comparisons/123/tiles/verify']).toBeDefined();
      expect(api.requests['/comparisons/1234/tiles/verify']).not.toBeDefined();
      expect(api.requests['/comparisons/123/tiles/verify'][0].method).toBe('POST');
    });
  });

  describe('#verify()', () => {
    it('throws when missing a comparison id', async () => {
      await expectAsync(client.verify())
        .toBeRejectedWithError('Missing comparison ID');
    });

    it('verify a comparison tile', async () => {
      api.reply('/comparisons/123/tiles/verify', async () => {
        return [200, 'success'];
      });

      await expectAsync(client.verify(123, 'sha')).toBeResolved();

      expect(api.requests['/comparisons/123/tiles/verify']).toBeDefined();
      expect(api.requests['/comparisons/1234/tiles/verify']).not.toBeDefined();
    });
  });

  describe('#finalizeComparison()', () => {
    it('throws when missing a comparison id', async () => {
      await expectAsync(client.finalizeComparison())
        .toBeRejectedWithError('Missing comparison ID');
    });

    it('finalizes a comparison', async () => {
      await expectAsync(client.finalizeComparison(123)).toBeResolved();
      expect(api.requests['/comparisons/123/finalize']).toBeDefined();
    });
  });

  describe('#sendComparison()', () => {
    describe('when correct comparison data is sent', () => {
      beforeEach(async () => {
        await client.sendComparison(123, {
          name: 'test snapshot name',
          tag: { name: 'test tag' },
          tiles: [{ content: base64encode('tile') }]
        });
      });

      it('creates a snapshot', async () => {
        expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
          data: {
            type: 'snapshots',
            attributes: {
              name: 'test snapshot name',
              scope: null,
              'test-case': null,
              tags: [],
              'scope-options': {},
              'enable-javascript': null,
              'minimum-height': null,
              widths: null,
              sync: false,
              regions: null,
              'enable-layout': false,
              'th-test-case-execution-id': null,
              browsers: null
            },
            relationships: {
              resources: {
                data: []
              }
            }
          }
        });
      });

      it('creates a comparison', async () => {
        expect(api.requests['/snapshots/4567/comparisons'][0].body).toEqual({
          data: {
            type: 'comparisons',
            attributes: {
              'external-debug-url': null,
              'ignore-elements-data': null,
              'consider-elements-data': null,
              'dom-info-sha': null,
              'element-selectors-data': null,
              sync: false,
              regions: null,
              metadata: null
            },
            relationships: {
              tag: {
                data: {
                  type: 'tag',
                  attributes: {
                    name: 'test tag',
                    width: null,
                    height: null,
                    'os-name': null,
                    'os-version': null,
                    orientation: null,
                    'browser-name': null,
                    'browser-version': null,
                    resolution: null,
                    'percy-browser-custom-name': null
                  }
                }
              },
              tiles: {
                data: [{
                  type: 'tiles',
                  attributes: {
                    sha: jasmine.any(String),
                    'status-bar-height': null,
                    'nav-bar-height': null,
                    'header-height': null,
                    'footer-height': null,
                    fullscreen: null
                  }
                }]
              }
            }
          }
        });
      });

      it('uploads comparison tiles', async () => {
        expect(api.requests['/comparisons/891011/tiles'][0].body).toEqual({
          data: {
            type: 'tiles',
            attributes: {
              'base64-content': base64encode(Buffer.from('tile')),
              index: 0
            }
          }
        });
      });

      it('finalizes a comparison', async () => {
        expect(api.requests['/snapshots/4567/finalize']).not.toBeDefined();
        expect(api.requests['/comparisons/891011/finalize']).toBeDefined();
      });
    });

    describe('when incorrect comparison data is sent', () => {
      it('throws error when tiles object does not contain sha, filepath or content', async () => {
        await expectAsync(client.sendComparison(123, {
          name: 'test snapshot name',
          tag: { name: 'test tag' },
          tiles: [{}]
        })).toBeRejectedWithError('sha, filepath or content should be present in tiles object');
      });
    });
  });

  describe('#tokenType', () => {
    let client;

    beforeEach(() => {
      client = new PercyClient({
        token: 'PERCY_TOKEN'
      });
    });

    it('should return web for default token', () => {
      client.token = '<<PERCY_TOKEN>>';
      expect(client.tokenType()).toBe('web');
    });

    it('should return web for web tokens', () => {
      client.token = 'web_abc';
      expect(client.tokenType()).toBe('web');
    });

    it('should return app for app tokens', () => {
      client.token = 'app_abc';
      expect(client.tokenType()).toBe('app');
    });

    it('should return automate for auto tokens', () => {
      client.token = 'auto_abc';
      expect(client.tokenType()).toBe('automate');
    });

    it('should return generic for ss tokens', () => {
      client.token = 'ss_abc';
      expect(client.tokenType()).toBe('generic');
    });

    it('should return web for default token', () => {
      client.token = 'abcdef123';
      expect(client.tokenType()).toBe('web');
    });

    it('should return visual_scanner for vmw token', () => {
      client.token = 'vmw_abc';
      expect(client.tokenType()).toBe('visual_scanner');
    });

    it('should return responsive_scanner for res token', () => {
      client.token = 'res_abc';
      expect(client.tokenType()).toBe('responsive_scanner');
    });

    it('should return web for no token', () => {
      client.token = '';
      expect(client.tokenType()).toBe('web');
    });
  });

  describe('#sendBuildEvents', () => {
    it('should send build event with default values', async () => {
      await expectAsync(client.sendBuildEvents(123, {
        errorKind: 'cli',
        client: 'percy-appium-dotnet',
        clientVersion: '3.0.1',
        cliVersion: '1.27.3',
        message: 'some error'
      })).toBeResolved();

      expect(api.requests['/builds/123/send-events']).toBeDefined();
      expect(api.requests['/builds/123/send-events'][0].method).toBe('POST');
      expect(api.requests['/builds/123/send-events'][0].body).toEqual({
        data: {
          errorKind: 'cli',
          client: 'percy-appium-dotnet',
          clientVersion: '3.0.1',
          cliVersion: '1.27.3',
          message: 'some error'
        }
      });
    });
  });

  describe('#sendBuildLogs', () => {
    it('should send build logs to API', async () => {
      await expectAsync(client.sendBuildLogs({
        content: 'abcd',
        build_id: 1234,
        reference_id: 1234,
        service_name: 'cli',
        base64encoded: true
      })).toBeResolved();

      expect(api.requests['/logs']).toBeDefined();
      expect(api.requests['/logs'][0].method).toBe('POST');
      expect(api.requests['/logs'][0].body).toEqual({
        data: {
          content: 'abcd',
          build_id: 1234,
          reference_id: 1234,
          service_name: 'cli',
          base64encoded: true
        }
      });
    });
  });

  describe('#getErrorAnalysis', () => {
    const sharedTest = (reqBody, expectedBody) => {
      it('should send error logs to API', async () => {
        await expectAsync(client.getErrorAnalysis(reqBody)).toBeResolved();

        expect(api.requests['/suggestions/from_logs']).toBeDefined();
        expect(api.requests['/suggestions/from_logs'][0].method).toBe('POST');
        expect(api.requests['/suggestions/from_logs'][0].body).toEqual({
          data: {
            logs: expectedBody
          }
        });
      });
    };
    describe('when error is of type array', () => {
      let body = [
        { message: 'Some Error Log' },
        { message: 'Some Error logs 2' }
      ];

      // Here requestedBody and expectedBody should be same
      sharedTest(body, body);
    });

    describe('when error is of type string', () => {
      sharedTest('some error', [{ message: 'some error' }]);
    });

    describe('when error is of type object', () => {
      sharedTest({
        some_key: 'some_error'
      }, [
        { message: { some_key: 'some_error' } },
        { message: '' }
      ]);
    });
  });

  describe('#mayBeLogUploadSize', () => {
    it('does not warns when upload size less 20MB/25MB', () => {
      client.mayBeLogUploadSize(1000);
      expect(logger.stderr).toEqual([]);
    });

    it('warns when upload size above 20MB', () => {
      client.mayBeLogUploadSize(20 * 1024 * 1024);
      expect(logger.stderr).toEqual(['[percy:client] Uploading resource above 20MB might slow the build...']);
    });

    it('log error when upload size above 25MB', () => {
      client.mayBeLogUploadSize(25 * 1024 * 1024);
      expect(logger.stderr).toEqual(['[percy:client] Uploading resource above 25MB might fail the build...']);
    });
  });

  describe('#getToken', () => {
    afterEach(() => {
      delete process.env.PERCY_TOKEN;
    });

    it('should throw error when called with true', () => {
      const client = new PercyClient({});
      expect(() => {
        client.getToken();
      }).toThrowError('Missing Percy token');
    });

    it('should not throw error when called with false', () => {
      const client = new PercyClient({
        token: 'PERCY_TOKEN'
      });
      expect(client.getToken(false)).toBe('PERCY_TOKEN');
    });

    it('should read from env package if token is not passed', () => {
      process.env.PERCY_TOKEN = 'PERCY_TOKEN';
      const client = new PercyClient({
        config: { percy: { token: 'DONT_USE_THIS' } }
      });
      expect(client.getToken()).toBe('PERCY_TOKEN');
    });

    it('should read from config if env is not set and config has percy.token', () => {
      const client = new PercyClient({
        config: { percy: { token: 'USE_THIS_TOKEN' } }
      });
      expect(client.getToken()).toBe('USE_THIS_TOKEN');
    });
  });

  describe('#headers()', () => {
    it('returns default headers with Authorization and User-Agent', () => {
      const headers = client.headers();

      expect(headers).toEqual({
        Authorization: 'Token token=PERCY_TOKEN',
        'User-Agent': jasmine.stringMatching(/^Percy\/v1 @percy\/client\/\S+ \(node\/v[\d.]+.*\)$/)
      });
    });

    it('merges additional headers with default headers', () => {
      const additionalHeaders = {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value'
      };

      const headers = client.headers(additionalHeaders);

      expect(headers).toEqual({
        Authorization: 'Token token=PERCY_TOKEN',
        'User-Agent': jasmine.stringMatching(/^Percy\/v1 @percy\/client\/\S+ \(node\/v[\d.]+.*\)$/),
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value'
      });
    });

    it('calls getToken with projectTokenRequired=true by default', () => {
      spyOn(client, 'getToken').and.returnValue('TEST_TOKEN');

      client.headers();

      expect(client.getToken).toHaveBeenCalledWith(true);
    });

    it('calls getToken with projectTokenRequired=false when specified', () => {
      spyOn(client, 'getToken').and.returnValue('TEST_TOKEN');

      client.headers({}, false);

      expect(client.getToken).toHaveBeenCalledWith(false);
    });
  });

  describe('#reviewBuild()', () => {
    it('sends a review request with correct parameters', async () => {
      await expectAsync(client.reviewBuild('123', 'approve', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/reviews'][0].method).toBe('POST');
      expect(api.requests['/reviews'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: `Basic ${base64encode('testuser:testkey')}`
        })
      );
      expect(api.requests['/reviews'][0].body).toEqual({
        data: {
          attributes: {
            action: 'approve'
          },
          relationships: {
            build: {
              data: {
                type: 'builds',
                id: '123'
              }
            }
          },
          type: 'reviews'
        }
      });
    });

    it('calls post with projectTokenRequired=false', async () => {
      spyOn(client, 'post').and.callThrough();

      await expectAsync(client.reviewBuild('123', 'reject', 'testuser', 'testkey')).toBeResolved();

      expect(client.post).toHaveBeenCalledWith(
        'reviews',
        jasmine.any(Object),
        { identifier: 'build.reject' },
        { Authorization: `Basic ${base64encode('testuser:testkey')}` },
        false
      );
    });

    it('validates build ID', async () => {
      await expectAsync(client.reviewBuild(null, 'approve', 'testuser', 'testkey'))
        .toBeRejectedWithError('Missing build ID');

      await expectAsync(client.reviewBuild('', 'approve', 'testuser', 'testkey'))
        .toBeRejectedWithError('Missing build ID');

      await expectAsync(client.reviewBuild({}, 'approve', 'testuser', 'testkey'))
        .toBeRejectedWithError('Invalid build ID');
    });

    it('logs debug message with action and build ID', async () => {
      spyOn(client.log, 'debug');

      await expectAsync(client.reviewBuild('456', 'unapprove', 'testuser', 'testkey')).toBeResolved();

      expect(client.log.debug).toHaveBeenCalledWith('Sending unapprove action for build 456...');
    });

    it('works with different action types', async () => {
      spyOn(client, 'post').and.callThrough();

      await expectAsync(client.reviewBuild('123', 'custom-action', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/reviews'][0].body.data.attributes.action).toBe('custom-action');
      expect(client.post).toHaveBeenCalledWith(
        'reviews',
        jasmine.any(Object),
        { identifier: 'build.custom-action' },
        jasmine.any(Object),
        false
      );
    });

    it('accepts numeric build ID', async () => {
      await expectAsync(client.reviewBuild(123, 'approve', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/reviews'][0].body.data.relationships.build.data.id).toBe(123);
    });
  });

  describe('#approveBuild()', () => {
    it('calls reviewBuild with approve action', async () => {
      spyOn(client, 'reviewBuild').and.returnValue(Promise.resolve({ success: true }));

      const result = await client.approveBuild('123', 'testuser', 'testkey');

      expect(client.reviewBuild).toHaveBeenCalledWith('123', 'approve', 'testuser', 'testkey');
      expect(result).toEqual({ success: true });
    });

    it('sends approve request to API', async () => {
      await expectAsync(client.approveBuild('123', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/reviews'][0].body.data.attributes.action).toBe('approve');
      expect(api.requests['/reviews'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: `Basic ${base64encode('testuser:testkey')}`
        })
      );
    });

    it('validates build ID', async () => {
      await expectAsync(client.approveBuild(null, 'testuser', 'testkey'))
        .toBeRejectedWithError('Missing build ID');
    });
  });

  describe('#unapproveBuild()', () => {
    it('calls reviewBuild with unapprove action', async () => {
      spyOn(client, 'reviewBuild').and.returnValue(Promise.resolve({ success: true }));

      const result = await client.unapproveBuild('456', 'testuser', 'testkey');

      expect(client.reviewBuild).toHaveBeenCalledWith('456', 'unapprove', 'testuser', 'testkey');
      expect(result).toEqual({ success: true });
    });

    it('sends unapprove request to API', async () => {
      await expectAsync(client.unapproveBuild('456', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/reviews'][0].body.data.attributes.action).toBe('unapprove');
      expect(api.requests['/reviews'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: `Basic ${base64encode('testuser:testkey')}`
        })
      );
    });

    it('validates build ID', async () => {
      await expectAsync(client.unapproveBuild('', 'testuser', 'testkey'))
        .toBeRejectedWithError('Missing build ID');
    });
  });

  describe('#rejectBuild()', () => {
    it('calls reviewBuild with reject action', async () => {
      spyOn(client, 'reviewBuild').and.returnValue(Promise.resolve({ success: true }));

      const result = await client.rejectBuild('789', 'testuser', 'testkey');

      expect(client.reviewBuild).toHaveBeenCalledWith('789', 'reject', 'testuser', 'testkey');
      expect(result).toEqual({ success: true });
    });

    it('sends reject request to API', async () => {
      await expectAsync(client.rejectBuild('789', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/reviews'][0].body.data.attributes.action).toBe('reject');
      expect(api.requests['/reviews'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: `Basic ${base64encode('testuser:testkey')}`
        })
      );
    });

    it('validates build ID', async () => {
      await expectAsync(client.rejectBuild({}, 'testuser', 'testkey'))
        .toBeRejectedWithError('Invalid build ID');
    });
  });

  describe('#deleteBuild()', () => {
    it('sends a delete request with correct parameters', async () => {
      await expectAsync(client.deleteBuild('123', 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/builds/123/delete'][0].method).toBe('POST');
      expect(api.requests['/builds/123/delete'][0].headers).toEqual(
        jasmine.objectContaining({
          Authorization: `Basic ${base64encode('testuser:testkey')}`
        })
      );
      expect(api.requests['/builds/123/delete'][0].body).toEqual({});
    });

    it('calls post with projectTokenRequired=false', async () => {
      spyOn(client, 'post').and.callThrough();

      await expectAsync(client.deleteBuild('123', 'testuser', 'testkey')).toBeResolved();

      expect(client.post).toHaveBeenCalledWith(
        'builds/123/delete',
        {},
        { identifier: 'build.delete' },
        { Authorization: `Basic ${base64encode('testuser:testkey')}` },
        false
      );
    });

    it('validates build ID', async () => {
      await expectAsync(client.deleteBuild(null, 'testuser', 'testkey'))
        .toBeRejectedWithError('Missing build ID');

      await expectAsync(client.deleteBuild('', 'testuser', 'testkey'))
        .toBeRejectedWithError('Missing build ID');

      await expectAsync(client.deleteBuild({}, 'testuser', 'testkey'))
        .toBeRejectedWithError('Invalid build ID');
    });

    it('logs debug message with build ID', async () => {
      spyOn(client.log, 'debug');

      await expectAsync(client.deleteBuild('456', 'testuser', 'testkey')).toBeResolved();

      expect(client.log.debug).toHaveBeenCalledWith('Sending Delete action for build 456...');
    });

    it('accepts numeric build ID', async () => {
      await expectAsync(client.deleteBuild(123, 'testuser', 'testkey')).toBeResolved();

      expect(api.requests['/builds/123/delete'][0].method).toBe('POST');
    });
  });

  describe('#updateProjectDomainConfig()', () => {
    beforeEach(() => {
      api.reply('/projects/domain-config', () => [204]);
    });

    it('calls PATCH with domain config data', async () => {
      spyOn(client, 'patch').and.callThrough();

      await expectAsync(client.updateProjectDomainConfig({
        buildId: '123',
        allowed: ['cdn.example.com'],
        blocked: ['bad.com']
      })).toBeResolved();

      expect(client.patch).toHaveBeenCalledWith(
        'projects/domain-config',
        {
          data: {
            type: 'projects',
            attributes: {
              'domain-config': {
                'build-id': '123',
                allowed: ['cdn.example.com'],
                blocked: ['bad.com']
              }
            }
          }
        },
        { identifier: 'project.updateDomainConfig' }
      );
    });

    it('logs debug message', async () => {
      spyOn(client.log, 'debug');

      await expectAsync(client.updateProjectDomainConfig({ buildId: '123' })).toBeResolved();

      expect(client.log.debug).toHaveBeenCalledWith('Updating domain config');
    });

    it('handles empty arrays', async () => {
      await expectAsync(client.updateProjectDomainConfig({ buildId: '456' })).toBeResolved();

      expect(api.requests['/projects/domain-config'][0].body).toEqual({
        data: {
          type: 'projects',
          attributes: {
            'domain-config': {
              'build-id': '456',
              allowed: [],
              blocked: []
            }
          }
        }
      });
    });

    it('uses defaults when called with no arguments', async () => {
      await expectAsync(client.updateProjectDomainConfig()).toBeResolved();

      // defaults should produce a domain-config body with undefined buildId and empty arrays
      const body = api.requests['/projects/domain-config'][0].body;
      expect(body.data.type).toBe('projects');
      expect(body.data.attributes['domain-config'].allowed).toEqual([]);
      expect(body.data.attributes['domain-config'].blocked).toEqual([]);
      // buildId will be undefined, which may or may not be serialized in JSON
    });

    it('calls patch with Unknown identifier when no meta identifier provided', async () => {
      // call patch directly with empty meta to hit the meta.identifier || 'Unknown' branch
      await expectAsync(client.patch('projects/domain-config', {}, {})).toBeResolved();
      expect(api.requests['/projects/domain-config'].length).toBeGreaterThan(0);
    });

    it('calls patch with raiseIfMissing=false', async () => {
      // call patch with raiseIfMissing=false to cover that branch
      await expectAsync(client.patch('projects/domain-config', {}, {}, {}, false)).toBeResolved();
      expect(api.requests['/projects/domain-config'].length).toBeGreaterThan(0);
    });

    it('calls patch with undefined meta to trigger default parameter', async () => {
      // call patch with explicit undefined for meta parameter to cover default branch
      await expectAsync(client.patch('projects/domain-config', {}, undefined)).toBeResolved();
      expect(api.requests['/projects/domain-config'].length).toBeGreaterThan(0);
    });
  });

  describe('#validateDomain()', () => {
    let workerMock;

    beforeEach(async () => {
      workerMock = await mockRequests(
        'https://winter-morning-fa32.shobhit-k.workers.dev',
        (req) => [200, { accessible: true, status_code: 200 }]
      );
    });

    it('makes POST request to Cloudflare worker', async () => {
      const result = await client.validateDomain('cdn.example.com');

      expect(result).toEqual({ accessible: true, status_code: 200 });
      expect(workerMock).toHaveBeenCalled();
    });

    it('logs debug message', async () => {
      spyOn(client.log, 'debug');

      await expectAsync(client.validateDomain('cdn.example.com')).toBeResolved();

      expect(client.log.debug).toHaveBeenCalledWith('Validating domain: cdn.example.com');
    });

    it('throws error on request failure', async () => {
      spyOn(client.log, 'debug');
      workerMock.and.returnValue([500, { error: 'Internal server error' }]);

      await expectAsync(client.validateDomain('cdn.example.com')).toBeRejected();

      expect(client.log.debug).toHaveBeenCalledWith(
        jasmine.stringMatching(/Domain validation failed for cdn\.example\.com/)
      );
    });

    it('handles network errors', async () => {
      spyOn(client.log, 'debug');
      // Simulate a network error by returning an error status without proper response
      workerMock.and.returnValue([0, '']); // Status 0 indicates network failure

      await expectAsync(client.validateDomain('cdn.example.com')).toBeRejected();
    });

    it('sends domain in request body', async () => {
      let capturedRequest;
      workerMock.and.callFake((req) => {
        capturedRequest = req;
        return [200, { accessible: false, status_code: 403 }];
      });

      await client.validateDomain('restricted.example.com');

      expect(capturedRequest.body.domain).toBe('restricted.example.com');
    });
  });
});
