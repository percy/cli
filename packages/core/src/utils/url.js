import { URL } from 'url';

// Returns the hostname portion of a URL.
export function hostname(url) {
  return new URL(url).hostname;
}

// Normalizes a URL by stripping any anchors
export function normalizeURL(url) {
  let { protocol, host, pathname, search } = new URL(url);
  return `${protocol}//${host}${pathname}${search}`;
}

// Returns true or false if the host matches the domain. When `isWild` is true,
// it will also return true if the host matches end of the domain.
function domainCheck(domain, host, isWild) {
  if (host === domain) {
    return true;
  }

  if (isWild && host) {
    let last = host.lastIndexOf(domain);
    return (last >= 0 && ((last + domain.length) === host.length));
  }

  return false;
}

// Returns true or false if `url` matches the provided domain `pattern`.
export function domainMatch(pattern, url) {
  if (pattern === '*') {
    return true;
  } else if (!pattern) {
    return false;
  }

  // check for wildcard patterns
  let isWild = (pattern.indexOf('*.') === 0) || (pattern.indexOf('*/') === 0);
  // get the pattern's domain and path prefix
  let slashed = pattern.split('/');
  let domain = isWild ? slashed.shift().substr(2) : slashed.shift();
  let pathprefix = `/${slashed.join('/')}`;

  // parse the provided URL
  let { hostname, pathname } = new URL(url);

  // check that the URL matches the pattern's domain and path prefix
  return domainCheck(domain, hostname, isWild) &&
    pathname.indexOf(pathprefix) === 0;
}
