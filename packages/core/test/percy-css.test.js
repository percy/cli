import expect from 'expect';
import Percy from '../src';
import { mockAPI, createTestServer, dedent } from './helpers';
import { sha256hash } from '@percy/client/dist/utils';

describe('Percy CSS', () => {
  let server, percy;

  let testDOM = dedent`
    <html>
    <head></head>
    <body><p>Hello Percy!<p></body>
    </html>
  `;

  beforeEach(async () => {
    server = await createTestServer();

    server.app.get('/', (req, res) => {
      res.set('Content-Type', 'text/html').send(testDOM);
    });

    percy = await Percy.start({
      token: 'PERCY_TOKEN',
      noServer: true,
      snapshot: {
        percyCSS: 'p { color: purple; }',
        widths: [1000]
      }
    });
  });

  afterEach(async () => {
    await percy?.stop();
    server.close();
  });

  it('creates a percy-specific CSS file', async () => {
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost',
      domSnapshot: testDOM
    });

    let resources = mockAPI.requests['/builds/123/snapshots'][0]
      .body.data.relationships.resources.data;

    expect(resources).toHaveLength(2);
    expect(resources[1].id).toBe(sha256hash('p { color: purple; }'));
    expect(resources[1].attributes['resource-url']).toMatch(/\/percy-specific\.\d+\.css$/);
  });

  it('creates a percy-specific CSS file for the snapshot option', async () => {
    percy.config.snapshot.percyCSS = '';
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost',
      domSnapshot: testDOM,
      percyCSS: 'body { color: purple; }'
    });

    let resources = mockAPI.requests['/builds/123/snapshots'][0]
      .body.data.relationships.resources.data;

    expect(resources).toHaveLength(2);
    expect(resources[1].id).toBe(sha256hash('body { color: purple; }'));
    expect(resources[1].attributes['resource-url']).toMatch(/\/percy-specific\.\d+\.css$/);
  });

  it('combines snapshot and global percy-specific CSS', async () => {
    await percy.snapshot({
      name: 'test snapshot',
      url: 'http://localhost',
      domSnapshot: testDOM,
      percyCSS: 'p { font-size: 2rem; }'
    });

    let resources = mockAPI.requests['/builds/123/snapshots'][0]
      .body.data.relationships.resources.data;

    expect(resources).toHaveLength(2);
    expect(resources[1].id).toBe(sha256hash('p { color: purple; }\np { font-size: 2rem; }'));
    expect(resources[1].attributes['resource-url']).toMatch(/\/percy-specific\.\d+\.css$/);
  });
});
