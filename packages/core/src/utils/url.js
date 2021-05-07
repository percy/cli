import { URL } from 'url';
export { hostnameMatches } from '@percy/client/dist/utils';

// Returns the hostname portion of a URL.
export function hostname(url) {
  return new URL(url).hostname;
}

// Normalizes a URL by stripping any anchors
export function normalizeURL(url) {
  let { protocol, host, pathname, search } = new URL(url);
  return `${protocol}//${host}${pathname}${search}`;
}
