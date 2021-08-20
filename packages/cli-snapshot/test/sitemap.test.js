import mockAPI from '@percy/client/test/helpers';
import logger from '@percy/logger/test/helpers';
import { createTestServer } from '@percy/core/test/helpers';
import { Snapshot } from '../src/commands/snapshot';

describe('percy snapshot <sitemap>', () => {
  let server;

  beforeEach(async () => {
    server = await createTestServer({
      default: () => [200, 'text/html', '<p>Test</p>'],
      '/sitemap.xml': () => [200, 'text/xml', [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>http://localhost:8000</loc>',
        '  </url>',
        '  <url>',
        '    <loc>http://localhost:8000/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>http://localhost:8000/test-1</loc>',
        '  </url>',
        '  <url>',
        '    <loc>http://localhost:8000/test-2</loc>',
        '  </url>',
        '</urlset>'
      ].join('\n')]
    });

    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    mockAPI.start(50);
    logger.mock();
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    process.removeAllListeners();
    await server.close();
  });

  it('snapshots URLs listed by a sitemap', async () => {
    await Snapshot.run(['http://localhost:8000/sitemap.xml', '--dry-run']);

    expect(logger.stderr).toEqual([]);
    expect(logger.stdout).toEqual([
      '[percy] Found 3 snapshots',
      '[percy] Snapshot found: /',
      '[percy] Snapshot found: /test-1',
      '[percy] Snapshot found: /test-2'
    ]);
  });

  it('throws an error when the sitemap is not an xml file', async () => {
    await expectAsync(Snapshot.run(['http://localhost:8000/not-a-sitemap']))
      .toBeRejectedWithError('EEXIT: 1');

    expect(logger.stdout).toEqual([]);
    expect(logger.stderr).toEqual([
      '[percy] Error: The sitemap must be an XML document, ' +
        'but the content-type was "text/html"'
    ]);
  });
});
