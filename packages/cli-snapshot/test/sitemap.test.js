import { fs, logger, setupTest, createTestServer } from '@percy/cli-command/test/helpers';
import snapshot from '@percy/cli-snapshot';

describe('percy snapshot <sitemap>', () => {
  let server;

  beforeEach(async () => {
    snapshot.packageInformation = { name: '@percy/cli-snapshot' };
    process.env.PERCY_TOKEN = '<<PERCY_TOKEN>>';
    await setupTest();

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
        '    <loc>http://localhost:8000/test-1/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>http://localhost:8000/test-2/</loc>',
        '  </url>',
        '</urlset>'
      ].join('\n')]
    });
  });

  afterEach(async () => {
    delete process.env.PERCY_TOKEN;
    delete snapshot.packageInformation;
    await server.close();
  });

  it('snapshots URLs listed by a sitemap', async () => {
    await snapshot(['http://localhost:8000/sitemap.xml', '--dry-run']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot found: /',
      '[percy] Snapshot found: /test-1/',
      '[percy] Snapshot found: /test-2/',
      '[percy] Found 3 snapshots'
    ]));
  });

  it('throws an error when the sitemap is not an xml file', async () => {
    await expectAsync(
      snapshot(['http://localhost:8000/not-a-sitemap'])
    ).toBeRejected();

    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Stopping percy...'
    ]));
    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created',
      '[percy] Error: The sitemap must be an XML document, ' +
        'but the content-type was "text/html"'
    ]));
  });

  it('accepts snapshot config options', async () => {
    fs.writeFileSync('.percy.yml', [
      'version: 2',
      'sitemap:',
      '  options:',
      '  - additionalSnapshots:',
      '    - suffix: " (2)"',
      '  - include: /^\\/$/',
      '    name: Home'
    ].join('\n'));

    await snapshot(['http://localhost:8000/sitemap.xml', '--dry-run']);

    expect(logger.stderr).toEqual(jasmine.arrayContaining([
      '[percy] Build not created'
    ]));
    expect(logger.stdout).toEqual(jasmine.arrayContaining([
      '[percy] Percy has started!',
      '[percy] Snapshot found: Home',
      '[percy] Snapshot found: Home (2)',
      '[percy] Snapshot found: /test-1/',
      '[percy] Snapshot found: /test-1/ (2)',
      '[percy] Snapshot found: /test-2/',
      '[percy] Snapshot found: /test-2/ (2)',
      '[percy] Found 6 snapshots'
    ]));
  });
});
