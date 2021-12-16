import { mapStaticSnapshots } from './static';
import { request } from '@percy/core/dist/utils';

// Fetches and maps sitemap URLs to snapshots.
export async function loadSitemapSnapshots(sitemapUrl, config) {
  // fetch sitemap URLs
  let urls = await request(sitemapUrl, (body, res) => {
    // validate sitemap content-type
    let [contentType] = res.headers['content-type'].split(';');

    if (!/^(application|text)\/xml$/.test(contentType)) {
      throw new Error('The sitemap must be an XML document, ' + (
        `but the content-type was "${contentType}"`));
    }

    // parse XML content into a list of URLs
    let urls = body.match(/(?<=<loc>)(.*)(?=<\/loc>)/ig);

    // filter out duplicate URLs that differ by a trailing slash
    return urls.filter((url, i) => {
      let match = urls.indexOf(url.replace(/\/$/, ''));
      return match === -1 || match === i;
    });
  });

  // map with inherited static options
  return mapStaticSnapshots(urls, config);
}
