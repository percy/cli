import http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

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
  }
};

function serveStaticFile(baseDir, urlPath, res, corsHeaders = {}) {
  const filePath = join(baseDir, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(baseDir)) {
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
  const corsPagesDir = join(__dirname, 'pages');

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
