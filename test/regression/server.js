import http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, 'pages');
const assetsDir = join(__dirname, 'assets');

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

// Pre-load static files used in special routes (no per-request readFileSync)
const wrongMimeFont = existsSync(join(assetsDir, 'fonts/test-font.woff2'))
  ? readFileSync(join(assetsDir, 'fonts/test-font.woff2'))
  : Buffer.alloc(0);
const logoPng = existsSync(join(assetsDir, 'images/logo.png'))
  ? readFileSync(join(assetsDir, 'images/logo.png'))
  : Buffer.alloc(0);

// ── Track F (functional) observation state ───────────────────────────────────
// The functional regression harness asserts on what the servers actually
// observed during a real `percy snapshot` discovery run, rather than on Percy's
// internal debug-log text. resetObservations() is called before each run; the
// /gated/* routes below populate this as discovery fetches their resources.
let observations = {};
function freshObservations() {
  return {
    requestHeader: null, // value of the configured discovery.requestHeaders entry
    authorization: null, // Authorization header sent for discovery.authorization
    cookie: null, // Cookie header sent for discovery.cookies
    userAgent: null, // User-Agent sent for discovery.userAgent
    srcset: [], // srcset candidate paths fetched (discovery.captureSrcset)
    disallowedProbeRequested: false // true if the disallowed 9101 host was hit
  };
}
observations = freshObservations();
export function getObservations() { return observations; }
export function resetObservations() { observations = freshObservations(); }

const css = (res, body = '/* gated regression resource */') => {
  res.writeHead(200, { 'content-type': 'text/css' });
  res.end(body);
};

// Special routes for the main server (add new entries to extend)
const mainRoutes = {
  '/redirect/style.css': (req, res) => {
    res.writeHead(302, { Location: '/assets/css/base.css' });
    res.end();
  },
  '/redirect/image.png': (req, res) => {
    res.writeHead(301, { Location: '/assets/images/logo.png' });
    res.end();
  },
  '/fonts/wrong-mime.woff2': (req, res) => {
    // Serves valid woff2 bytes with intentionally wrong MIME type
    // Tests Percy's font MIME detection (magic byte sniffing)
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(wrongMimeFont);
  },

  // ── Track F gated resources — record the request, then serve ───────────────
  // discovery.requestHeaders — records the custom header Percy injected.
  '/gated/header.css': (req, res) => {
    observations.requestHeader = req.headers['x-percy-regression'] ?? null;
    css(res);
  },
  // discovery.authorization — 401 without Basic auth so a missing header is a
  // hard failure; records the Authorization header Percy sent.
  '/gated/auth.css': (req, res) => {
    observations.authorization = req.headers.authorization ?? null;
    if (!req.headers.authorization) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="regression"' });
      res.end('Unauthorized');
      return;
    }
    css(res);
  },
  // discovery.cookies — records the Cookie header Percy sent.
  '/gated/cookie.css': (req, res) => {
    observations.cookie = req.headers.cookie ?? null;
    css(res);
  },
  // discovery.userAgent — records the User-Agent Percy sent.
  '/gated/ua.css': (req, res) => {
    observations.userAgent = req.headers['user-agent'] ?? null;
    css(res);
  },
  // discovery.captureSrcset — records which srcset candidates were fetched.
  '/gated/srcset-1x.png': (req, res) => {
    observations.srcset.push('1x');
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(logoPng);
  },
  '/gated/srcset-2x.png': (req, res) => {
    observations.srcset.push('2x');
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(logoPng);
  }
};

function serveStaticFile(baseDir, urlPath, res, corsHeaders = {}) {
  // Sanitize: strip query strings, decode URI, remove null bytes
  const sanitized = decodeURIComponent(urlPath.split('?')[0]).replace(/\0/g, '');

  // Resolve to absolute path and verify it's within baseDir (prevents path traversal)
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const filePath = resolve(baseDir, sanitized);
  const resolvedBase = resolve(baseDir);

  if (!filePath.startsWith(resolvedBase + '/') && filePath !== resolvedBase) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);

  res.writeHead(200, { 'content-type': contentType, ...corsHeaders });
  res.end(content);
}

function createMainServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Check special routes first
    if (mainRoutes[pathname]) {
      mainRoutes[pathname](req, res);
      return;
    }

    // Serve assets from /assets/ path
    if (pathname.startsWith('/assets/')) {
      const assetPath = pathname.replace('/assets/', '');
      serveStaticFile(assetsDir, assetPath, res);
      return;
    }

    // Serve pages from root path (e.g., /comprehensive.html → pages/comprehensive.html)
    const pagePath = pathname === '/' ? 'comprehensive.html' : pathname.slice(1);
    serveStaticFile(pagesDir, pagePath, res);
  });
}

function createCorsServer() {
  const corsAssetsDir = join(__dirname, 'assets');

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      res.end();
      return;
    }

    // Track F: discovery.disallowedHostnames probe. If this 9101 resource is
    // requested at all, the disallowed-hostname block did NOT take effect. The
    // functional harness asserts this stays false when the host is disallowed.
    if (pathname === '/disallowed-probe.css') {
      observations.disallowedProbeRequested = true;
      res.writeHead(200, { 'content-type': 'text/css', ...corsHeaders });
      res.end('/* disallowed probe */');
      return;
    }

    // Serve assets with CORS headers
    if (pathname.startsWith('/css/') || pathname.startsWith('/images/') ||
        pathname.startsWith('/fonts/') || pathname.startsWith('/js/')) {
      serveStaticFile(corsAssetsDir, pathname.slice(1), res, corsHeaders);
      return;
    }

    // Serve CORS iframe page
    if (pathname === '/iframe-page.html') {
      const content = `<!DOCTYPE html>
<html><head><title>CORS Iframe</title></head>
<body><p>Cross-origin iframe content served from port 9101</p></body>
</html>`;
      res.writeHead(200, { 'content-type': 'text/html', ...corsHeaders });
      res.end(content);
      return;
    }

    // Routes WITHOUT CORS headers (for testing blocked scenarios)
    if (pathname === '/no-cors/image.png') {
      serveStaticFile(corsAssetsDir, 'images/logo.png', res);
      return;
    }

    res.writeHead(404, corsHeaders);
    res.end('Not Found');
  });
}

let mainServer;
let corsServer;

export function startServers() {
  return new Promise((resolve, reject) => {
    mainServer = createMainServer();
    corsServer = createCorsServer();

    let ready = 0;
    const onReady = () => {
      ready++;
      if (ready === 2) resolve();
    };

    mainServer.listen(9100, '127.0.0.1', onReady);
    corsServer.listen(9101, '127.0.0.1', onReady);

    mainServer.on('error', reject);
    corsServer.on('error', reject);
  });
}

export function stopServers() {
  return Promise.all([
    mainServer ? new Promise(r => mainServer.close(r)) : Promise.resolve(),
    corsServer ? new Promise(r => corsServer.close(r)) : Promise.resolve()
  ]);
}
