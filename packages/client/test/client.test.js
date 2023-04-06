import fs from 'fs';
import logger from '@percy/logger/test/helpers';
import { mockgit } from '@percy/env/test/helpers';
import { sha256hash, base64encode } from '@percy/client/utils';
import PercyClient from '@percy/client';
import api from './helpers.js';

describe('PercyClient', () => {
  let client;

  beforeEach(async () => {
    await logger.mock({ level: 'debug' });
    await api.mock();

    client = new PercyClient({
      token: 'PERCY_TOKEN'
    });
  });

  describe('#userAgent()', () => {
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
      expect(logger.stderr).toEqual([]);
    });

    it('it logs a debug warning when no info is passed', async () => {
      client = new PercyClient({
        token: 'PERCY_TOKEN'
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

    it('throws when missing a percy token', () => {
      expect(() => new PercyClient().post('foobar', {}))
        .toThrowError('Missing Percy token');
    });
  });

  describe('#createBuild()', () => {
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
            partial: client.env.partial
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
            partial: client.env.partial
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
            partial: client.env.partial
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
      await expectAsync(client.uploadResource(123, { content: 'foo' })).toBeResolved();

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
        minHeight: 1000,
        enableJavaScript: true,
        clientInfo: 'sdk/info',
        environmentInfo: 'sdk/env',
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

      expect(api.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: 'snapfoo',
            widths: [1000],
            scope: '#main',
            'minimum-height': 1000,
            'enable-javascript': true
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
            'minimum-height': null,
            'enable-javascript': null
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
            'enable-javascript': null,
            'minimum-height': null,
            widths: null
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

      await expectAsync(client.createComparison(4567, {
        tag: {
          name: 'tagfoo',
          width: 748,
          height: 1024,
          osName: 'fooOS',
          osVersion: '0.1.0',
          orientation: 'portrait'
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
        externalDebugUrl: 'http://debug.localhost'
      })).toBeResolved();

      expect(api.requests['/snapshots/4567/comparisons'][0].body).toEqual({
        data: {
          type: 'comparisons',
          attributes: {
            'external-debug-url': 'http://debug.localhost'
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
                  orientation: 'portrait'
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
            'external-debug-url': null
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
                  orientation: null
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

    it('returns false if tile is not verified', async () => {
      api.reply('/comparisons/891011/tiles/verify', async () => {
        return [400, 'failure'];
      });

      await expectAsync(client.uploadComparisonTiles(891011, [
        { sha: sha256hash('foo') }
      ])).toBeResolvedTo([
        false
      ]);
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
            'enable-javascript': null,
            'minimum-height': null,
            widths: null
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
            'external-debug-url': null
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
                  orientation: null
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
});
