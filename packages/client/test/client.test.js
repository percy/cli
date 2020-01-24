import expect from 'expect';
import mock from 'mock-require';
import PercyClient from '../src';
import { sha256hash, base64encode } from '../src/utils';
import mockAPI from './helper';

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

  it('uses the correct http agent determined by the apiUrl', () => {
    let httpsAgent = require('https').Agent;
    let httpAgent = require('http').Agent;

    expect(client.httpAgent).toBeInstanceOf(httpsAgent);

    client = new PercyClient({
      token: 'PERCY_AGENT',
      apiUrl: 'http://localhost'
    });

    expect(client.httpAgent).not.toBeInstanceOf(httpsAgent);
    expect(client.httpAgent).toBeInstanceOf(httpAgent);
  });

  describe('#userAgent()', () => {
    it('contains client and environment information', () => {
      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/[\d.]+ \(node\/v[\d.]+.*\)$/
      );
    });

    it('contains any additional client and environment information', () => {
      client = new PercyClient({
        token: 'PERCY_TOKEN',
        clientInfo: 'client-info',
        environmentInfo: 'env-info'
      });

      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/[\d.]+ client-info \(env-info; node\/v[\d.]+.*\)$/
      );
    });

    it('does not duplicate or include empty client and environment information', () => {
      client.addClientInfo(null);
      client.addClientInfo(undefined);
      client.addClientInfo('');
      client.addClientInfo('client-info');
      client.addClientInfo('client-info');
      client.addEnvironmentInfo(null);
      client.addEnvironmentInfo(undefined);
      client.addEnvironmentInfo('');
      client.addEnvironmentInfo('env-info');
      client.addEnvironmentInfo('env-info');

      expect(client.userAgent()).toMatch(
        /^Percy\/v1 @percy\/client\/[\d.]+ client-info \(env-info; node\/v[\d.]+.*\)$/
      );
    });
  });

  describe('#get()', () => {
    it('sends a GET request to the API', async () => {
      await expect(client.get('foobar')).resolves.toBeDefined();
      expect(mockAPI.requests['/foobar'][0].method).toBe('GET');
      expect(mockAPI.requests['/foobar'][0].headers).toEqual(
        expect.objectContaining({
          authorization: 'Token token=PERCY_TOKEN'
        })
      );
    });

    it('throws an error with a missing token', () => {
      expect(() => new PercyClient().get('foobar'))
        .toThrow('Missing Percy token');
    });
  });

  describe('#post()', () => {
    it('sends a POST request to the API', async () => {
      await expect(client.post('foobar', { test: '123' })).resolves.toBeDefined();
      expect(mockAPI.requests['/foobar'][0].body).toEqual({ test: '123' });
      expect(mockAPI.requests['/foobar'][0].method).toBe('POST');
      expect(mockAPI.requests['/foobar'][0].headers).toEqual(
        expect.objectContaining({
          authorization: 'Token token=PERCY_TOKEN',
          'content-type': 'application/vnd.api+json'
        })
      );
    });

    it('throws an error with a missing token', () => {
      expect(() => new PercyClient().post('foobar', {}))
        .toThrow('Missing Percy token');
    });
  });

  describe('#createBuild()', () => {
    it('creates a new build', async () => {
      await expect(
        client.createBuild({
          resources: [{
            url: '/foobar',
            sha: 'provided-sha',
            mimetype: 'text/html',
            root: true
          }, {
            url: '/bazqux',
            content: 'content-sha'
          }]
        })
      ).resolves.toEqual({
        data: {
          id: '123',
          attributes: {
            'build-number': 1,
            'web-url': 'https://percy.io/test/test/123'
          }
        }
      });

      expect(client.build).toEqual({
        id: '123',
        url: 'https://percy.io/test/test/123',
        number: 1
      });

      expect(mockAPI.requests['/builds'][0].body).toEqual({
        data: {
          type: 'builds',
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
          },
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
        }
      });
    });

    it('throws an error when there is an active build', async () => {
      await expect(client.setBuildData({ id: 123 }).createBuild())
        .rejects.toThrow('This client instance has not finalized the previous build');
    });
  });

  describe('#getBuild()', () => {
    it('gets build data', async () => {
      mockAPI.reply('/builds/100', () => [200, { data: '<<build-data>>' }]);
      await expect(client.getBuild(100)).resolves.toEqual({ data: '<<build-data>>' });
    });
  });

  describe('#getBuilds()', () => {
    it('gets project builds data', async () => {
      mockAPI.reply('/projects/test/builds', () => [200, { data: ['<<build-data>>'] }]);
      await expect(client.getBuilds('test')).resolves.toEqual({ data: ['<<build-data>>'] });
    });

    it('gets project builds data filtered by a sha', async () => {
      mockAPI.reply('/projects/test/builds?filter[sha]=test-sha', () => (
        [200, { data: ['<<build-data>>'] }]
      ));

      await expect(client.getBuilds('test', { sha: 'test-sha' }))
        .resolves.toEqual({ data: ['<<build-data>>'] });
    });

    it('gets project builds data filtered by state, branch, and shas', async () => {
      mockAPI.reply('/projects/test/builds?' + [
        'filter[branch]=master',
        'filter[state]=finished',
        'filter[shas][]=test-sha-1',
        'filter[shas][]=test-sha-2'
      ].join('&'), () => [200, {
        data: ['<<build-data>>']
      }]);

      await expect(
        client.getBuilds('test', {
          branch: 'master',
          state: 'finished',
          shas: ['test-sha-1', 'test-sha-2']
        })
      ).resolves.toEqual({
        data: ['<<build-data>>']
      });
    });
  });

  describe('#finalizeBuild()', () => {
    it('throws an error when there is no active build', async () => {
      await expect(client.finalizeBuild())
        .rejects.toThrow('This client instance has no active build');
    });

    it('finalizes the build', async () => {
      await expect(
        client.setBuildData({ id: 123 }).finalizeBuild()
      ).resolves.toBeDefined();

      expect(client.build.id).toBeUndefined();
      expect(client.build.number).toBeUndefined();
      expect(client.build.url).toBeUndefined();

      expect(mockAPI.requests['/builds/123/finalize']).toBeDefined();
    });

    it('can finalize all shards of a build', async () => {
      await expect(
        client.setBuildData({ id: 123 }).finalizeBuild({ all: true })
      ).resolves.toBeDefined();

      expect(mockAPI.requests['/builds/123/finalize?all-shards=true']).toBeDefined();
    });
  });

  describe('#uploadResource()', () => {
    it('throws an error when there is no active build', async () => {
      await expect(client.uploadResource({}))
        .rejects.toThrow('This client instance has no active build');
    });

    it('uploads a resource for the current active build', async () => {
      await expect(
        client.setBuildData({ id: 123 }).uploadResource({ content: 'foo' })
      ).resolves.toBeDefined();

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

    it('uploads a resource from a local path', async () => {
      mock('fs', { readFileSync: path => `contents of ${path}` });

      await expect(
        client
          .setBuildData({ id: 123 })
          .uploadResource({
            sha: 'foo-sha',
            filepath: 'foo/bar'
          })
      ).resolves.toBeDefined();

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
    it('throws an error when there is no active build', async () => {
      await expect(client.uploadResources([{}]))
        .rejects.toThrow('This client instance has no active build');
    });

    it('does nothing when no resources are provided', async () => {
      await expect(client.setBuildData({ id: 123 }).uploadResources([]))
        .resolves.toEqual([]);
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
      await expect(
        client
          .setBuildData({ id: 123 })
          .uploadResources([
            { filepath: 'foo/bar' },
            { filepath: 'foo/bar' },
            { filepath: 'foo/bar' },
            { filepath: 'foo/bar' }
          ])
      ).resolves.toEqual([
        { success: 'foo' },
        { success: 'foo' },
        { success: 'bar' },
        { success: 'bar' }
      ]);
    });
  });

  describe('#createSnapshot()', () => {
    it('throws an error when there is no active build', async () => {
      await expect(client.createSnapshot())
        .rejects.toThrow('This client instance has no active build');
    });

    it('creates a snapshot', async () => {
      await expect(
        client
          .setBuildData({ id: 123 })
          .createSnapshot({
            name: 'snapfoo',
            widths: [1000],
            minimumHeight: 1000,
            enableJavaScript: true,
            clientInfo: 'sdk/info',
            environmentInfo: 'sdk/env',
            resources: [{
              url: '/foobar',
              content: 'foo',
              mimetype: 'text/html',
              root: true
            }]
          })
      ).resolves.toBeDefined();

      expect(mockAPI.requests['/builds/123/snapshots'][0].headers).toEqual(
        expect.objectContaining({
          'user-agent': expect.stringMatching(
            /^Percy\/v1 @percy\/client\/[\d.]+ sdk\/info \(sdk\/env; node\/v[\d.]+.*\)$/
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
      await expect(
        client
          .setBuildData({ id: 123 })
          .createSnapshot({ resources: [{ sha: 'sha' }] })
      ).resolves.toBeDefined();

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
    it('finalizes a snapshot', async () => {
      await expect(client.finalizeSnapshot(123)).resolves.toBeDefined();
      expect(mockAPI.requests['/snapshots/123/finalize']).toBeDefined();
    });

    it('retries server errors', async () => {
      mockAPI
        .reply('/snapshots/123/finalize', () => [502])
        .reply('/snapshots/123/finalize', () => [503])
        .reply('/snapshots/123/finalize', () => [520])
        .reply('/snapshots/123/finalize', () => [200, { success: true }]);

      await expect(client.finalizeSnapshot(123)).resolves.toEqual({ success: true });
      expect(mockAPI.requests['/snapshots/123/finalize']).toHaveLength(4);
    });

    it('fails retrying after 5 attempts', async () => {
      mockAPI.reply('/snapshots/123/finalize', () => [502, { success: false }]);
      await expect(client.finalizeSnapshot(123)).rejects.toThrow('502 {"success":false}');
      expect(mockAPI.requests['/snapshots/123/finalize']).toHaveLength(5);
    });

    it('does not retry request errors', async () => {
      mockAPI.reply('/snapshots/123/finalize', () => [400, { errors: [{ detail: 'Wrong' }] }]);
      await expect(client.finalizeSnapshot(123)).rejects.toThrow('Wrong');
      expect(mockAPI.requests['/snapshots/123/finalize']).toHaveLength(1);
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

    beforeEach(() => {
      client.setBuildData({ id: '123' });
    });

    it('creates a snapshot', async () => {
      await expect(
        client.sendSnapshot({
          name: 'test snapshot name',
          resources: [{
            sha: sha256hash(testDOM),
            mimetype: 'text/html',
            content: testDOM,
            root: true
          }]
        })
      ).resolves.toBeUndefined();

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
      await expect(
        client.sendSnapshot({
          name: 'test snapshot name',
          resources: [{
            sha: sha256hash(testDOM),
            mimetype: 'text/html',
            content: testDOM,
            root: true
          }]
        })
      ).resolves.toBeUndefined();

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
      await expect(client.sendSnapshot({ name: 'test snapshot name' })).resolves.toBeUndefined();
      expect(mockAPI.requests['/snapshots/4567/finalize']).toBeDefined();
    });
  });
});
