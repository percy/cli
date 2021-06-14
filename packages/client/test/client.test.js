import mock from 'mock-require';
import { mockgit } from '@percy/env/test/helpers';
import PercyClient from '../src';
import { sha256hash, base64encode } from '../src/utils';
import mockAPI from './helpers';

describe('PercyClient', () => {
  let client;

  beforeEach(() => {
    mockAPI.start();
    client = new PercyClient({
      token: 'PERCY_TOKEN'
    });
  });

  afterEach(() => {
    mock.stopAll();
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
      expect(mockAPI.requests['/foobar'][0].method).toBe('GET');
      expect(mockAPI.requests['/foobar'][0].headers).toEqual(
        jasmine.objectContaining({
          authorization: 'Token token=PERCY_TOKEN'
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
      expect(mockAPI.requests['/foobar'][0].body).toEqual({ test: '123' });
      expect(mockAPI.requests['/foobar'][0].method).toBe('POST');
      expect(mockAPI.requests['/foobar'][0].headers).toEqual(
        jasmine.objectContaining({
          authorization: 'Token token=PERCY_TOKEN',
          'content-type': 'application/vnd.api+json'
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

      expect(mockAPI.requests['/builds'][0].body.data)
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

      expect(mockAPI.requests['/builds'][0].body.data)
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
  });

  describe('#getBuild()', () => {
    it('throws when missing a build id', async () => {
      await expectAsync(client.getBuild())
        .toBeRejectedWithError('Missing build ID');
    });

    it('gets build data', async () => {
      mockAPI.reply('/builds/100', () => [200, { data: '<<build-data>>' }]);
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
        .toBeRejectedWithError('Invalid project path. Expected "org/project" but recieved "test"');
    });

    it('gets project builds data', async () => {
      mockAPI.reply('/projects/foo/bar/builds', () => [200, { data: ['<<build-data>>'] }]);
      await expectAsync(client.getBuilds('foo/bar')).toBeResolvedTo({ data: ['<<build-data>>'] });
    });

    it('gets project builds data filtered by a sha', async () => {
      mockAPI.reply('/projects/foo/bar/builds?filter[sha]=test-sha', () => (
        [200, { data: ['<<build-data>>'] }]
      ));

      await expectAsync(client.getBuilds('foo/bar', { sha: 'test-sha' }))
        .toBeResolvedTo({ data: ['<<build-data>>'] });
    });

    it('gets project builds data filtered by state, branch, and shas', async () => {
      mockAPI.reply('/projects/foo/bar/builds?' + [
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
    it('throws when missing a build or commit sha', () => {
      expect(() => client.waitForBuild({}))
        .toThrowError('Missing build ID or commit SHA');
    });

    it('throws when missing a project with a commit sha', () => {
      expect(() => client.waitForBuild({ commit: '...' }))
        .toThrowError('Missing project path for commit');
    });

    it('throws when using an invalid project path', () => {
      expect(() => client.waitForBuild({ commit: '...', project: 'test' }))
        .toThrowError('Invalid project path. Expected "org/project" but recieved "test"');
    });

    it('invokes the callback when data changes while waiting', async () => {
      let progress = 0;

      mockAPI
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
      mockAPI.reply('/builds/123', () => [200, {
        data: { attributes: { state: 'processing' } }
      }]);

      await expectAsync(client.waitForBuild({ build: '123', timeout: 1500, interval: 50 }))
        .toBeRejectedWithError('Timeout exceeded without an update');
    });

    it('resolves when the build completes', async () => {
      mockAPI
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
      mockgit.commit
        .withArgs([jasmine.anything(), 'HEAD'])
        .and.returnValue('parsed-sha');

      mockAPI
        .reply('/projects/foo/bar/builds?filter[sha]=parsed-sha', () => [200, {
          data: [{ attributes: { state: 'processing' } }]
        }])
        .reply('/projects/foo/bar/builds?filter[sha]=parsed-sha', () => [200, {
          data: [{ attributes: { state: 'finished' } }]
        }]);

      await expectAsync(client.waitForBuild({ project: 'foo/bar', commit: 'HEAD', interval: 50 }))
        .toBeResolvedTo({ data: { attributes: { state: 'finished' } } });
    });

    it('defaults to the provided commit when revision parsing fails', async () => {
      mockgit.commit.and.throwError(new Error('test'));

      mockAPI.reply('/projects/foo/bar/builds?filter[sha]=abcdef', () => [200, {
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
      expect(mockAPI.requests['/builds/123/finalize']).toBeDefined();
    });

    it('can finalize all shards of a build', async () => {
      await expectAsync(client.finalizeBuild(123, { all: true })).toBeResolved();
      expect(mockAPI.requests['/builds/123/finalize?all-shards=true']).toBeDefined();
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

      expect(mockAPI.requests['/builds/123/resources'][0].body).toEqual({
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
      mock('fs', { readFileSync: path => `contents of ${path}` });

      await expectAsync(client.uploadResource(123, {
        sha: 'foo-sha',
        filepath: 'foo/bar'
      })).toBeResolved();

      expect(mockAPI.requests['/builds/123/resources'][0].body).toEqual({
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

      // to test this, the API is set to delay responses by 15ms...
      mockAPI.reply('/builds/123/resources', async () => {
        await new Promise(r => setTimeout(r, 12));
        return [201, { success: content }];
      });

      // ...after 20ms (enough time for a single request) the contents change...
      setTimeout(() => (content = 'bar'), 20);
      mock('fs', { readFileSync: () => content });

      // ... which should result in every 2 uploads being identical
      await expectAsync(client.uploadResources(123, [
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' },
        { filepath: 'foo/bar' }
      ])).toBeResolvedTo([
        { success: 'foo' },
        { success: 'foo' },
        { success: 'bar' },
        { success: 'bar' }
      ]);
    });

    it('throws any errors from uploading', async () => {
      await expectAsync(client.uploadResources(123, [{}])).toBeRejectedWithError();
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
      await expectAsync(client.createSnapshot(123, {
        name: 'snapfoo',
        widths: [1000],
        minHeight: 1000,
        enableJavaScript: true,
        clientInfo: 'sdk/info',
        environmentInfo: 'sdk/env',
        resources: [{
          url: '/foobar',
          content: 'foo',
          mimetype: 'text/html',
          root: true
        }]
      })).toBeResolved();

      expect(mockAPI.requests['/builds/123/snapshots'][0].headers).toEqual(
        jasmine.objectContaining({
          'user-agent': jasmine.stringMatching(
            /^Percy\/v1 @percy\/client\/\S+ sdk\/info \(sdk\/env; node\/v[\d.]+.*\)$/
          )
        })
      );

      expect(mockAPI.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: 'snapfoo',
            widths: [1000],
            'minimum-height': 1000,
            'enable-javascript': true
          },
          relationships: {
            resources: {
              data: [{
                type: 'resources',
                id: sha256hash('foo'),
                attributes: {
                  'resource-url': '/foobar',
                  'is-root': true,
                  mimetype: 'text/html'
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

      expect(mockAPI.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: null,
            widths: null,
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
      expect(mockAPI.requests['/snapshots/123/finalize']).toBeDefined();
    });

    it('retries server errors', async () => {
      mockAPI
        .reply('/snapshots/123/finalize', () => [502])
        .reply('/snapshots/123/finalize', () => [503])
        .reply('/snapshots/123/finalize', () => [520])
        .reply('/snapshots/123/finalize', () => [200, { success: true }]);

      await expectAsync(client.finalizeSnapshot(123)).toBeResolvedTo({ success: true });
      expect(mockAPI.requests['/snapshots/123/finalize']).toHaveSize(4);
    });

    it('retries certain request errors', async () => {
      mockAPI.cleanAll().nock.persist(false)
        .post('/snapshots/123/finalize').replyWithError({ code: 'ECONNREFUSED' })
        .post('/snapshots/123/finalize').replyWithError({ code: 'EHOSTUNREACH' })
        .post('/snapshots/123/finalize').replyWithError({ code: 'ECONNRESET' })
        .post('/snapshots/123/finalize').replyWithError({ code: 'EAI_AGAIN' })
        .post('/snapshots/123/finalize').reply(200, { success: true });

      await expectAsync(client.finalizeSnapshot(123)).toBeResolvedTo({ success: true });
      expect(mockAPI.nock.isDone()).toBe(true);
    });

    it('does not retry bad requests or unknown errors', async () => {
      mockAPI.reply('/snapshots/123/finalize', () => [400, { errors: [{ detail: 'Wrong' }] }]);
      await expectAsync(client.finalizeSnapshot(123)).toBeRejectedWithError('Wrong');
      expect(mockAPI.requests['/snapshots/123/finalize']).toHaveSize(1);

      mockAPI.cleanAll().nock.persist(false)
        .post('/snapshots/123/finalize').replyWithError(new Error('Unknown'));
      await expectAsync(client.finalizeSnapshot(123)).toBeRejectedWithError('Unknown');
      expect(mockAPI.nock.isDone()).toBe(true);
    });

    it('fails retrying after 5 attempts', async () => {
      mockAPI.reply('/snapshots/123/finalize', () => [502, { success: false }]);
      await expectAsync(client.finalizeSnapshot(123)).toBeRejectedWithError('502 {"success":false}');
      expect(mockAPI.requests['/snapshots/123/finalize']).toHaveSize(5);
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
            root: true
          }]
        })
      ).toBeResolved();

      expect(mockAPI.requests['/builds/123/snapshots'][0].body).toEqual({
        data: {
          type: 'snapshots',
          attributes: {
            name: 'test snapshot name',
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

      expect(mockAPI.requests['/builds/123/resources'][0].body).toEqual({
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
      expect(mockAPI.requests['/snapshots/4567/finalize']).toBeDefined();
    });
  });
});
