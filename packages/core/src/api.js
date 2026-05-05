import fs from 'fs';
import path, { dirname, resolve } from 'path';
import logger from '@percy/logger';
import { normalize } from '@percy/config/utils';
import { getPackageJSON, Server, percyAutomateRequestHandler, percyBuildEventHandler, computeResponsiveWidths } from './utils.js';
import { ServerError } from './server.js';
import WebdriverUtils from '@percy/webdriver-utils';
import { handleSyncJob } from './snapshot.js';
import { dump as adbDump, firstMatch as adbFirstMatch, SELECTOR_KEYS_WHITELIST, getSchemaDriftSeen as getMaestroHierarchyDrift } from './maestro-hierarchy.js';
import { PNG_MAGIC_BYTES, parsePngDimensions, isPortrait as isPortraitByAspect } from './png-dimensions.js';
import { resolveWdaSession } from './wda-session-resolver.js';
import { resolveIosRegions } from './wda-hierarchy.js';
import { request as percyRequest } from '@percy/client/utils';
import Busboy from 'busboy';
import { Readable } from 'stream';
// Previously, we used `createRequire(import.meta.url).resolve` to resolve the path to the module.
// This approach relied on `createRequire`, which is Node.js-specific and less compatible with modern ESM (ECMAScript Module) standards.
// This was leading to hard coded paths when CLI is used as a dependency in another project.
// Now, we use `fileURLToPath` and `path.resolve` to determine the absolute path in a way that's more aligned with ESM conventions.
// This change ensures better compatibility and avoids relying on Node.js-specific APIs that might cause issues in ESM environments.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

export const getPercyDomPath = (url) => {
  try {
    return createRequire(url).resolve('@percy/dom');
  } catch (error) {
    logger('core:server').warn([
      'Failed to resolve @percy/dom path using createRequire.',
      'Falling back to using fileURLToPath and path.resolve.'
    ].join(' '));
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, 'node_modules/@percy/dom');
};

// Resolved path for PERCY_DOM
export const PERCY_DOM = getPercyDomPath(import.meta.url);

// Returns a URL encoded string of nested query params
function encodeURLSearchParams(subj, prefix) {
  return typeof subj === 'object' ? Object.entries(subj).map(([key, value]) => (
    encodeURLSearchParams(value, prefix ? `${prefix}[${key}]` : key)
  )).join('&') : `${prefix}=${encodeURIComponent(subj)}`;
}

// Create a Percy CLI API server instance
export function createPercyServer(percy, port) {
  let pkg = getPackageJSON(import.meta.url);

  let server = Server.createServer({ port })
  // general middleware
    .route((req, res, next) => {
      // treat all request bodies as json (skip for multipart form data)
      let contentType = req.headers['content-type'] || '';
      if (req.body && !contentType.startsWith('multipart/form-data')) {
        try { req.body = JSON.parse(req.body); } catch {}
      }

      // add version header
      res.setHeader('Access-Control-Expose-Headers', '*, X-Percy-Core-Version');

      // skip or change api version header in testing mode
      if (percy.testing?.version !== false) {
        res.setHeader('X-Percy-Core-Version', percy.testing?.version ?? pkg.version);
      }

      // track all api requests in testing mode
      if (percy.testing && !req.url.pathname.startsWith('/test/')) {
        (percy.testing.requests ||= []).push({
          url: `${req.url.pathname}${req.url.search}`,
          method: req.method,
          body: req.body
        });
      }

      // support sabotaging requests in testing mode
      if (percy.testing?.api?.[req.url.pathname] === 'error') {
        next = () => Promise.reject(new Error(percy.testing.build?.error || 'testing'));
      } else if (percy.testing?.api?.[req.url.pathname] === 'disconnect') {
        next = () => req.connection.destroy();
      }

      // return json errors
      return next().catch(e => res.json(e.status ?? 500, {
        build: percy.testing?.build || percy.build,
        error: e.message,
        success: false
      }));
    })
  // healthcheck returns basic information
    .route('get', '/percy/healthcheck', (req, res) => {
      // Schema-drift dirty bit for the maestro view-hierarchy resolver.
      // Set inside maestro-hierarchy.js on the first schema-class gRPC failure.
      // Surfaced here (vs. only in the debug log) to close the silent-drift gap
      // that bit PERCY_LABELS — see
      // docs/solutions/integration-issues/percy-labels-cli-schema-rejection-2026-04-23.md.
      const drift = getMaestroHierarchyDrift();
      const body = {
        build: percy.testing?.build ?? percy.build,
        loglevel: percy.loglevel(),
        config: percy.config,
        widths: {
          // This is always needed even if width is passed
          mobile: percy.deviceDetails ? percy.deviceDetails.map((d) => d.width) : [],
          // This will only be used if width is not passed in options
          config: percy.config.snapshot.widths
        },
        deviceDetails: percy.deviceDetails || [],
        success: true,
        type: percy.client.tokenType()
      };
      if (drift) body.maestroHierarchyDrift = drift;
      return res.json(200, body);
    })
  // compute widths configuration with heights
    .route('get', '/percy/widths-config', (req, res) => {
      // Parse widths from query parameters (e.g., ?widths=375,1280)
      const widthsParam = req.url.searchParams.get('widths');
      const userPassedWidths = widthsParam ? widthsParam.split(',').map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w)) : [];

      const eligibleWidths = {
        mobile: percy.deviceDetails ? percy.deviceDetails.map((d) => d.width) : [],
        config: percy.config.snapshot.widths
      };
      const deviceDetails = percy.deviceDetails || [];

      const widths = computeResponsiveWidths(userPassedWidths, eligibleWidths, deviceDetails);

      return res.json(200, {
        widths,
        success: true
      });
    })
  // get or set config options
    .route(['get', 'post'], '/percy/config', async (req, res) => res.json(200, {
      config: req.body ? percy.set(req.body) : percy.config,
      success: true
    }))
  // responds once idle (may take a long time)
    .route('get', '/percy/idle', async (req, res) => res.json(200, {
      success: await percy.idle().then(() => true)
    }))
  // convenient @percy/dom bundle
    .route('get', '/percy/dom.js', (req, res) => {
      return res.file(200, PERCY_DOM);
    })
  // legacy agent wrapper for @percy/dom
    .route('get', '/percy-agent.js', async (req, res) => {
      logger('core:server').deprecated([
        'It looks like you’re using @percy/cli with an older SDK.',
        'Please upgrade to the latest version to fix this warning.',
        'See these docs for more info: https://www.browserstack.com/docs/percy/migration/migrate-to-cli'
      ].join(' '));

      let content = await fs.promises.readFile(PERCY_DOM, 'utf-8');
      let wrapper = '(window.PercyAgent = class { snapshot(n, o) { return PercyDOM.serialize(o); } });';
      return res.send(200, 'application/javascript', content.concat(wrapper));
    })
  // post one or more snapshots, optionally async
    .route('post', '/percy/snapshot', async (req, res) => {
      let data;
      const snapshotPromise = {};
      const snapshot = percy.snapshot(req.body, snapshotPromise);
      if (!req.url.searchParams.has('async')) await snapshot;

      if (percy.syncMode(req.body)) data = await handleSyncJob(snapshotPromise[req.body.name], percy, 'snapshot');

      return res.json(200, { success: true, data: data });
    })
  // post one or more comparisons, optionally waiting
    .route('post', '/percy/comparison', async (req, res) => {
      let data;
      if (percy.syncMode(req.body)) {
        const snapshotPromise = new Promise((resolve, reject) => percy.upload(req.body, { resolve, reject }, 'app'));
        data = await handleSyncJob(snapshotPromise, percy, 'comparison');
      } else {
        let upload = percy.upload(req.body, null, 'app');
        if (req.url.searchParams.has('await')) await upload;
      }

      // generate and include one or more redirect links to comparisons
      let link = ({ name, tag }) => [
        percy.client.apiUrl, '/comparisons/redirect?',
        encodeURLSearchParams(normalize({
          buildId: percy.build?.id, snapshot: { name }, tag
        }, { snake: true }))
      ].join('');

      const response = { success: true, data: data };
      if (req.body) {
        if (Array.isArray(req.body)) {
          response.links = req.body.map(link);
        } else {
          response.link = link(req.body);
        }
      }
      return res.json(200, response);
    })
  // post a comparison via multipart file upload
    .route('post', '/percy/comparison/upload', async (req, res) => {
      const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

      let contentType = req.headers['content-type'] || '';
      if (!contentType.startsWith('multipart/form-data')) {
        throw new ServerError(400, 'Content-Type must be multipart/form-data');
      }

      // Guard against empty request body
      if (!req.body) {
        throw new ServerError(400, 'Empty request body');
      }

      // Parse multipart form data from the raw body buffer
      let fields = Object.create(null);
      let fileBuffer = null;

      await new Promise((resolve, reject) => {
        let bb = Busboy({
          headers: req.headers,
          limits: { fileSize: MAX_FILE_SIZE }
        });

        bb.on('file', (fieldname, stream, info) => {
          let chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('limit', () => {
            // File exceeds size limit — reject immediately
            reject(new ServerError(413, 'File size exceeds maximum of 50MB'));
          });
          stream.on('end', () => {
            if (fieldname === 'screenshot') {
              fileBuffer = Buffer.concat(chunks);
            }
          });
        });

        bb.on('field', (fieldname, value) => {
          // Only accept known field names to prevent prototype pollution
          if (['name', 'tag', 'clientInfo', 'environmentInfo', 'testCase', 'labels'].includes(fieldname)) {
            fields[fieldname] = value;
          }
        });

        bb.on('close', resolve);
        bb.on('error', reject);

        // Feed the already-collected body buffer into busboy
        let stream = Readable.from(req.body);
        stream.on('error', reject);
        stream.pipe(bb);
      });

      // Validate screenshot file was provided
      if (!fileBuffer) {
        throw new ServerError(400, 'Missing required file part: screenshot');
      }

      // Validate PNG magic bytes
      if (fileBuffer.length < 8 || !fileBuffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)) {
        throw new ServerError(400, 'File is not a valid PNG image');
      }

      // Validate required fields
      if (!fields.name) throw new ServerError(400, 'Missing required field: name');
      if (!fields.tag) throw new ServerError(400, 'Missing required field: tag');

      // Parse tag JSON
      let tag;
      try {
        tag = JSON.parse(fields.tag);
      } catch {
        throw new ServerError(400, 'Invalid JSON in tag field');
      }

      // Base64-encode the PNG file
      let base64Content = fileBuffer.toString('base64');

      // Construct comparison payload
      let payload = {
        name: fields.name,
        tag,
        tiles: [{
          content: base64Content,
          statusBarHeight: 0,
          navBarHeight: 0,
          headerHeight: 0,
          footerHeight: 0,
          fullscreen: false
        }],
        clientInfo: fields.clientInfo || '',
        environmentInfo: fields.environmentInfo || ''
      };

      if (fields.testCase) payload.testCase = fields.testCase;
      if (fields.labels) payload.labels = fields.labels;

      // Upload via percy
      let upload = percy.upload(payload, null, 'app');
      if (req.url.searchParams.has('await')) await upload;

      // Generate redirect link
      let link = [
        percy.client.apiUrl, '/comparisons/redirect?',
        encodeURLSearchParams(normalize({
          buildId: percy.build?.id, snapshot: { name: payload.name }, tag
        }, { snake: true }))
      ].join('');

      return res.json(200, { success: true, link });
    })
  // post a comparison by reading a Maestro screenshot from disk
    .route('post', '/percy/maestro-screenshot', async (req, res) => {
      let { name, sessionId } = req.body || {};

      if (!name) throw new ServerError(400, 'Missing required field: name');
      if (!sessionId) throw new ServerError(400, 'Missing required field: sessionId');

      // Strict character-class validation — rejects path separators, shell metacharacters,
      // NUL, newlines, and anything else that could confuse the glob or the filesystem.
      const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
      if (!SAFE_ID.test(name)) {
        throw new ServerError(400, 'Invalid screenshot name');
      }
      if (!SAFE_ID.test(sessionId)) {
        throw new ServerError(400, 'Invalid sessionId');
      }

      // Resolve platform signal: strict whitelist on `platform` when present; default Android when absent.
      // Backward compatible with SDK v0.2.0 (no platform field → Android glob).
      let platform = 'android';
      if (req.body.platform !== undefined) {
        if (typeof req.body.platform !== 'string') {
          throw new ServerError(400, 'Invalid platform: must be a string');
        }
        let normalized = req.body.platform.toLowerCase();
        if (normalized !== 'ios' && normalized !== 'android') {
          throw new ServerError(400, `Invalid platform: must be "ios" or "android", got "${req.body.platform}"`);
        }
        platform = normalized;
      }

      // Validate regions input shape early (before file I/O and ADB work) so
      // malformed requests don't consume resolver/relay work.
      if (req.body.regions !== undefined) {
        if (!Array.isArray(req.body.regions)) {
          throw new ServerError(400, 'regions must be an array');
        }
        if (req.body.regions.length > 50) {
          throw new ServerError(400, 'regions exceeds maximum of 50');
        }
        for (let [idx, region] of req.body.regions.entries()) {
          if (region && region.element !== undefined) {
            if (typeof region.element !== 'object' || region.element === null || Array.isArray(region.element)) {
              throw new ServerError(400, `regions[${idx}].element must be an object`);
            }
            let keys = Object.keys(region.element);
            if (keys.length !== 1) {
              throw new ServerError(400, `regions[${idx}].element must have exactly one selector key`);
            }
            let [key] = keys;
            if (!SELECTOR_KEYS_WHITELIST.includes(key)) {
              throw new ServerError(400, `regions[${idx}].element: unsupported selector key "${key}" (allowed: ${SELECTOR_KEYS_WHITELIST.join(', ')})`);
            }
            let value = region.element[key];
            if (typeof value !== 'string' || value.length === 0) {
              throw new ServerError(400, `regions[${idx}].element.${key} must be a non-empty string`);
            }
            if (value.length > 512) {
              throw new ServerError(400, `regions[${idx}].element.${key} exceeds maximum length of 512`);
            }
          }
        }
      }

      // Find the screenshot file on disk. Pattern depends on platform:
      //   Android (BrowserStack mobile): /tmp/{sid}_test_suite/logs/*/screenshots/{name}.png
      //   iOS (BrowserStack realmobile): /tmp/{sid}/<maestro_debug_dir>/**/{name}.png
      //     realmobile builds SCREENSHOTS_DIR with literal slashes from the flow-path
      //     concatenation, causing Maestro to mkdir a deeply nested structure under the
      //     {device}_maestro_debug_ root. The `**` recursive match handles any depth.
      //     Exact {name}.png match at the leaf filters out Maestro's emoji-prefixed
      //     debug frames (e.g., `screenshot-❌-<timestamp>-(flow).png`).
      let searchPattern = platform === 'ios'
        ? `/tmp/${sessionId}/*_maestro_debug_*/**/${name}.png`
        : `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png`;

      let files;
      try {
        let { default: glob } = await import('fast-glob');
        files = await glob(searchPattern);
      } catch {
        // Fallback: manual directory walk (depth-limited to defeat malicious deep nesting).
        files = [];
        try {
          if (platform === 'ios') {
            let sessionDir = `/tmp/${sessionId}`;
            let walk = async (dir, depth) => {
              if (depth > 15) return; // sanity cap
              let entries;
              try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
              for (let entry of entries) {
                let full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  await walk(full, depth + 1);
                } else if (entry.isFile() && entry.name === `${name}.png` && full.includes('_maestro_debug_')) {
                  files.push(full);
                }
              }
            };
            await walk(sessionDir, 0);
          } else {
            let baseDir = `/tmp/${sessionId}_test_suite/logs`;
            let logDirs = await fs.promises.readdir(baseDir);
            for (let dir of logDirs) {
              let screenshotPath = path.join(baseDir, dir, 'screenshots', `${name}.png`);
              try {
                await fs.promises.access(screenshotPath);
                files.push(screenshotPath);
              } catch { /* not found, continue */ }
            }
          }
        } catch { /* base dir not found */ }
      }

      if (!files || files.length === 0) {
        throw new ServerError(404, `Screenshot not found: ${name}.png (searched ${searchPattern})`);
      }

      // If multiple files match (iOS — same name reused across flows), pick the most recently modified
      // for determinism.
      let chosenFile;
      if (files.length === 1) {
        chosenFile = files[0];
      } else {
        let mtimes = await Promise.all(files.map(async f => {
          try { return { f, mtime: (await fs.promises.stat(f)).mtimeMs }; } catch { return { f, mtime: 0 }; }
        }));
        mtimes.sort((a, b) => b.mtime - a.mtime);
        chosenFile = mtimes[0].f;
      }

      // Canonicalize and confirm the resolved path still lives under the sessionId-owned dir.
      // Defeats symlink swaps where a sessionId-named dir points elsewhere.
      // We resolve both the file and the expected prefix because /tmp is a symlink on macOS
      // (iOS hosts run macOS, where /tmp → /private/tmp).
      let expectedSessionRoot = platform === 'ios'
        ? `/tmp/${sessionId}`
        : `/tmp/${sessionId}_test_suite`;
      let realPath, realPrefix;
      try {
        realPath = await fs.promises.realpath(chosenFile);
        realPrefix = await fs.promises.realpath(expectedSessionRoot);
      } catch {
        throw new ServerError(404, `Screenshot not found: ${name}.png (path resolution failed)`);
      }
      if (!realPath.startsWith(`${realPrefix}/`)) {
        throw new ServerError(404, `Screenshot not found: ${name}.png (resolved outside session dir)`);
      }

      // Read and base64-encode the screenshot
      let fileContent = await fs.promises.readFile(realPath);
      let base64Content = fileContent.toString('base64');

      // Build tag from optional request body fields
      let tag = req.body.tag || { name: 'Unknown Device', osName: 'Android' };
      if (!tag.name) tag.name = 'Unknown Device';

      // Construct comparison payload with tile metadata from request
      let payload = {
        name,
        tag,
        tiles: [{
          content: base64Content,
          statusBarHeight: req.body.statusBarHeight || 0,
          navBarHeight: req.body.navBarHeight || 0,
          headerHeight: 0,
          footerHeight: 0,
          fullscreen: req.body.fullscreen || false
        }],
        clientInfo: req.body.clientInfo || 'percy-maestro/0.1.0',
        environmentInfo: req.body.environmentInfo || 'percy-maestro'
      };

      if (req.body.testCase) payload.testCase = req.body.testCase;
      if (req.body.labels) payload.labels = req.body.labels;
      if (req.body.thTestCaseExecutionId) payload.thTestCaseExecutionId = req.body.thTestCaseExecutionId;

      // Transform and forward regions if present.
      //
      // Resolver dispatch:
      //   Android — `maestroDump({ platform: 'android' })` + per-region `firstMatch`
      //   iOS (default — `PERCY_IOS_RESOLVER` unset/'wda-direct') — wda-hierarchy
      //     source-dump resolver (existing path; gated for deletion in Phase 4 of
      //     the 2026-04-27 plan once Phase 0.5 empirical probe passes).
      //   iOS (new — `PERCY_IOS_RESOLVER=maestro-hierarchy`) — `maestroDump` +
      //     per-region `firstMatch` (Phase 1 Unit 3 of the plan; the iOS branch of
      //     the resolver is currently a Unit 2a stub returning 'not-implemented'
      //     until Unit 2b lands the real attribute mapping post Phase 0.5).
      // Coordinate regions: transform to boundingBox as before.
      if (req.body.regions && Array.isArray(req.body.regions)) {
        const useMaestroHierarchyForIos = process.env.PERCY_IOS_RESOLVER === 'maestro-hierarchy';
        let resolvedRegions = [];
        let elementRegionCount = req.body.regions.filter(r => r && r.element).length;
        let cachedDump = null; // request-local lazy dump (Android always; iOS when env switch on)
        let elementSkipWarned = false;
        let iosResult = null; // iOS WDA-direct path — resolved in one call, shared by all element regions

        // iOS WDA-direct path (legacy; Phase 4 deletes when Phase 0.5 PASSes).
        // Skipped entirely when the maestro-hierarchy env switch is on — that
        // path uses the Android-style lazy + per-region pattern in the loop below.
        if (platform === 'ios' && elementRegionCount > 0 && !useMaestroHierarchyForIos) {
          try {
            // PNG parse — reuse the already-read buffer (avoids a second read).
            const dims = parsePngDimensions(fileContent);
            iosResult = await resolveIosRegions({
              regions: req.body.regions,
              sessionId,
              pngWidth: dims.width,
              pngHeight: dims.height,
              isPortrait: isPortraitByAspect(dims),
              deps: {
                httpClient: percyRequest,
                readWdaMeta: sid => resolveWdaSession({ sessionId: sid })
              }
            });
          } catch (err) {
            // Parse failure (invalid-png / truncated) — warn and skip all element regions.
            percy.log.warn(`iOS element regions skipped — ${err.message || 'png-parse-error'}`);
            iosResult = { resolvedRegions: [], warnings: ['png-unparseable'] };
          }
          // Surface warnings to the caller-visible log stream.
          for (const w of (iosResult.warnings || [])) {
            percy.log.warn(`iOS element region warn-skip: ${w}`);
          }
        }
        let iosIndex = 0;

        for (let region of req.body.regions) {
          let resolved = null;

          if (region.top != null && region.bottom != null && region.left != null && region.right != null) {
            // Coordinate-based region
            resolved = {
              elementSelector: {
                boundingBox: {
                  x: region.left,
                  y: region.top,
                  width: region.right - region.left,
                  height: region.bottom - region.top
                }
              },
              algorithm: region.algorithm || 'ignore'
            };
          } else if (region.element) {
            if (platform === 'ios' && !useMaestroHierarchyForIos) {
              // Legacy iOS WDA-direct: iosResult.resolvedRegions is a dense array of
              // successfully resolved element regions in input order. Warnings
              // (zero-match, class-not-allowlisted, etc.) were already logged; we just
              // forward each resolved region by positional index.
              const r = iosResult && iosResult.resolvedRegions[iosIndex++];
              if (!r) continue;
              resolved = r;
            } else {
              // Cross-platform path (Android always; iOS when PERCY_IOS_RESOLVER=maestro-hierarchy):
              // lazy dump + memoize result (including errors), then per-region firstMatch.
              if (cachedDump === null) {
                cachedDump = await adbDump({ platform });
              }
              if (cachedDump.kind !== 'hierarchy') {
                if (!elementSkipWarned) {
                  percy.log.warn(
                    `Element-region resolver ${cachedDump.kind} (${cachedDump.reason}) — skipping ${elementRegionCount} element regions`
                  );
                  elementSkipWarned = true;
                }
                continue;
              }
              let bbox = adbFirstMatch(cachedDump.nodes, region.element);
              if (!bbox) {
                percy.log.warn(`Element region not found: ${JSON.stringify(region.element)} — skipping`);
                continue;
              }
              resolved = {
                elementSelector: { boundingBox: bbox },
                algorithm: region.algorithm || 'ignore'
              };
            }
          } else {
            percy.log.warn('Invalid region format, skipping');
            continue;
          }

          if (region.configuration) resolved.configuration = region.configuration;
          if (region.padding) resolved.padding = region.padding;
          if (region.assertion) resolved.assertion = region.assertion;
          resolvedRegions.push(resolved);
        }

        if (resolvedRegions.length > 0) {
          payload.regions = resolvedRegions;
        }
      }

      // Upload via percy — sync or fire-and-forget
      if (req.body.sync === true) payload.sync = true;

      let data;
      if (percy.syncMode(payload)) {
        const snapshotPromise = new Promise((resolve, reject) => percy.upload(payload, { resolve, reject }, 'app'));
        data = await handleSyncJob(snapshotPromise, percy, 'comparison');
        return res.json(200, { success: true, data });
      }

      let upload = percy.upload(payload, null, 'app');
      if (req.url.searchParams.has('await')) await upload;

      // Generate redirect link
      let link = [
        percy.client.apiUrl, '/comparisons/redirect?',
        encodeURLSearchParams(normalize({
          buildId: percy.build?.id,
          snapshot: { name },
          tag
        }, { snake: true }))
      ].join('');

      return res.json(200, { success: true, link });
    })
  // flushes one or more snapshots from the internal queue
    .route('post', '/percy/flush', async (req, res) => res.json(200, {
      success: await percy.flush(req.body).then(() => true)
    }))
    .route('post', '/percy/automateScreenshot', async (req, res) => {
      let data;
      percyAutomateRequestHandler(req, percy);
      let comparisonData = await WebdriverUtils.captureScreenshot(req.body);

      if (percy.syncMode(comparisonData)) {
        const snapshotPromise = new Promise((resolve, reject) => percy.upload(comparisonData, { resolve, reject }, 'automate'));
        data = await handleSyncJob(snapshotPromise, percy, 'comparison');
      } else {
        percy.upload(comparisonData, null, 'automate');
      }

      res.json(200, { success: true, data: data });
    })
  // Receives events from sdk's.
    .route('post', '/percy/events', async (req, res) => {
      const body = percyBuildEventHandler(req, pkg.version);
      await percy.client.sendBuildEvents(percy.build?.id, body);
      res.json(200, { success: true });
    })
    .route('post', '/percy/log', async (req, res) => {
      const log = logger('sdk');
      if (!req.body) {
        log.error('No request body for /percy/log endpoint');
        return res.json(400, { error: 'No body passed' });
      }
      const level = req.body.level;
      const message = req.body.message;
      const meta = req.body.meta || {};

      log[level](message, meta);

      res.json(200, { success: true });
    })
  // stops percy at the end of the current event loop
    .route('/percy/stop', (req, res) => {
      setImmediate(() => percy.stop());
      return res.json(200, { success: true });
    });

  // add test endpoints only in testing mode
  return !percy.testing ? server : server
  // manipulates testing mode configuration to trigger specific scenarios
    .route('/test/api/:cmd', ({ body, params: { cmd } }, res) => {
      body = Buffer.isBuffer(body) ? body.toString() : body;

      if (cmd === 'reset') {
        // the reset command will reset testing mode and clear any logs
        percy.testing = {};
        logger.instance.messages.clear();
      } else if (cmd === 'version') {
        // the version command will update the api version header for testing
        percy.testing.version = body;
      } else if (cmd === 'config') {
        percy.config.snapshot.widths = body.config;
        // Support setting deviceDetails directly or deriving from mobile widths
        percy.deviceDetails = body.deviceDetails || body.mobile?.map((w) => { return { width: w }; });
        percy.config.snapshot.responsiveSnapshotCapture = !!body.responsive;
        percy.config.percy.deferUploads = !!body.deferUploads;
      } else if (cmd === 'error' || cmd === 'disconnect') {
        // the error or disconnect commands will cause specific endpoints to fail
        (percy.testing.api ||= {})[body] = cmd;
      } else if (cmd === 'build-failure') {
        // the build-failure command will cause api errors to include a failed build
        percy.testing.build = { failed: true, error: 'Build failed' };
      } else if (cmd === 'build-created') {
        // the build-failure command will cause api errors to include a failed build
        percy.testing.build = { id: '123', url: 'https://percy.io/test/test/123' };
      } else {
        // 404 for unknown commands
        return res.send(404);
      }

      return res.json(200, { success: true });
    })
  // returns an array of raw requests made to the api
    .route('get', '/test/requests', (req, res) => res.json(200, {
      requests: percy.testing.requests
    }))
  // returns an array of raw logs from the logger
    .route('get', '/test/logs', (req, res) => res.json(200, {
      logs: Array.from(logger.instance.messages)
    }))
  // serves a very basic html page for testing snapshots
    .route('get', '/test/snapshot', (req, res) => {
      return res.send(200, 'text/html', '<p>Snapshot Me!</p>');
    });
}

// Create a static server instance with an automatic sitemap
export function createStaticServer(options) {
  let { serve: dir, baseUrl = '' } = options;
  let server = Server.createServer(options);

  // remove trailing slashes so the base snapshot name matches other snapshots
  baseUrl = baseUrl.replace(/\/$/, '');

  // used when generating an automatic sitemap
  let toURL = Server.createRewriter((
    // reverse rewrites' src, dest, & order
    Object.entries(options?.rewrites ?? {})
      .reduce((acc, rw) => [rw.reverse(), ...acc], [])
  ), (filename, rewrite) => new URL(path.posix.join('/', baseUrl, (
    // cleanUrls will trim trailing .html/index.html from paths
    !options.cleanUrls ? rewrite(filename) : (
      rewrite(filename).replace(/(\/index)?\.html$/, ''))
  )), server.address()));

  // include automatic sitemap route
  server.route('get', `${baseUrl}/sitemap.xml`, async (req, res) => {
    let { default: glob } = await import('fast-glob');
    let files = await glob('**/*.html', { cwd: dir, fs });

    return res.send(200, 'application/xml', [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...files.map(name => `  <url><loc>${toURL(name)}</loc></url>`),
      '</urlset>'
    ].join('\n'));
  });

  return server;
}
