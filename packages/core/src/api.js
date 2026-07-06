import fs from 'fs';
import path, { dirname, resolve } from 'path';
import logger from '@percy/logger';
import { normalize } from '@percy/config/utils';
import { getPackageJSON, Server, percyAutomateRequestHandler, percyBuildEventHandler, computeResponsiveWidths } from './utils.js';
import { ServerError } from './server.js';
import WebdriverUtils from '@percy/webdriver-utils';
import { handleSyncJob } from './snapshot.js';
import { dump as maestroDump, firstMatch as maestroFirstMatch, SELECTOR_KEYS_WHITELIST, getMaestroHierarchyDrift } from './maestro-hierarchy.js';
import Busboy from 'busboy';
import { Readable } from 'stream';
// Previously, we used `createRequire(import.meta.url).resolve` to resolve the path to the module.
// This approach relied on `createRequire`, which is Node.js-specific and less compatible with modern ESM (ECMAScript Module) standards.
// This was leading to hard coded paths when CLI is used as a dependency in another project.
// Now, we use `fileURLToPath` and `path.resolve` to determine the absolute path in a way that's more aligned with ESM conventions.
// This change ensures better compatibility and avoids relying on Node.js-specific APIs that might cause issues in ESM environments.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { configSchema } from './config.js';

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

// Walks the config schema and collects dot-paths of any fields marked `httpReadOnly: true`
// that are present in `body`. Driving this from the schema means new HTTP-blocked fields
// only need a one-line annotation next to their definition — no list to keep in sync here.
function findHttpReadOnlyPaths(body, schema, path = '') {
  if (!body || typeof body !== 'object' || !schema?.properties) return [];
  let paths = [];
  for (let [key, propSchema] of Object.entries(schema.properties)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let childPath = path ? `${path}.${key}` : key;
    if (propSchema?.httpReadOnly) {
      paths.push(childPath);
    } else {
      paths.push(...findHttpReadOnlyPaths(body[key], propSchema, childPath));
    }
  }
  return paths;
}

// Top-level configSchema is a map of subschemas keyed by top-level config namespace
// (`discovery`, `snapshot`, …). Wrap it as a single object schema so the walker can recurse
// uniformly from the root.
const ROOT_CONFIG_SCHEMA = { type: 'object', properties: configSchema };

// Removes each dot-path's leaf from a deep clone of `body` and logs a warning per path.
// Returns the original `body` unchanged when `paths` is empty so we don't pay for a clone
// on every config request. Exported for unit testing: the `?.` chain in the reduce is a
// defensive guard for paths whose ancestor is absent from `body`. Through the production
// caller (stripBlockedConfigFields → findHttpReadOnlyPaths) every intermediate is verified
// present, so the guard is unreachable in normal use — but the explicit paths parameter
// lets a unit test exercise it without contorting the schema.
export function _applyHttpReadOnlyStripping(body, paths, log) {
  if (!paths.length) return body;

  let stripped = JSON.parse(JSON.stringify(body));
  for (let p of paths) {
    let parts = p.split('.');
    let leaf = parts.pop();
    let parent = parts.reduce((o, k) => o?.[k], stripped);
    if (parent && typeof parent === 'object') delete parent[leaf];
    log.warn(`Ignoring \`${p}\` from /percy/config request: this field can only be set via the config file or CLI at startup.`);
  }
  return stripped;
}

// Returns a body with `httpReadOnly` fields removed. Caller guarantees `body` is truthy.
function stripBlockedConfigFields(body, log) {
  return _applyHttpReadOnlyStripping(body, findHttpReadOnlyPaths(body, ROOT_CONFIG_SCHEMA), log);
}

// Snapshot option keys whose values are executed as JavaScript in the browser:
// `domTransformation` is passed to window.eval and `execute` (incl. its
// beforeSnapshot/afterNavigation/before|afterResize hooks) is run via page.eval.
const REMOTE_SCRIPT_FIELDS = ['execute', 'domTransformation'];

// The local /percy/snapshot endpoint is unauthenticated, so accepting code-
// bearing fields from a network request body lets any local caller inject
// arbitrary JavaScript into the (possibly authenticated) page being snapshotted
// (CWE-94 — PER-8607, PER-8613). Strip those fields from HTTP-sourced snapshots
// by default; the config-file / CLI path (`percy snapshot`) calls percy.snapshot
// directly and never passes through this route, so legitimate config-sourced
// execute/domTransformation are unaffected. Trusted programmatic callers can opt
// back in with PERCY_ALLOW_REMOTE_SCRIPTS=true.
export function stripRemoteScriptFields(body, log) {
  if (process.env.PERCY_ALLOW_REMOTE_SCRIPTS === 'true') return body;
  if (!body || typeof body !== 'object') return body;

  let stripped = JSON.parse(JSON.stringify(body));
  let removed = new Set();
  let walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (let key of Object.keys(node)) {
        if (REMOTE_SCRIPT_FIELDS.includes(key)) {
          delete node[key];
          removed.add(key);
        } else {
          walk(node[key]);
        }
      }
    }
  };
  walk(stripped);

  if (removed.size) {
    // Report fields in their canonical declaration order, not discovery order,
    // so the warning is deterministic regardless of body key ordering.
    let removedList = REMOTE_SCRIPT_FIELDS.filter(f => removed.has(f));
    log.warn(
      `Ignoring \`${removedList.join('`, `')}\` from /percy/snapshot request: these run ` +
      'arbitrary JavaScript and are not accepted over the local API. Set them via the config ' +
      'file or CLI, or set PERCY_ALLOW_REMOTE_SCRIPTS=true to allow them on this endpoint.'
    );
  }
  return stripped;
}

// Parse PNG IHDR chunk for the screenshot's actual rendered dimensions.
// Returns { width, height } when the buffer is a valid PNG with non-zero
// dimensions, or null otherwise (non-PNG signature, truncated file, zero
// IHDR values). PNG layout per W3C spec:
//   bytes 0..7   PNG signature (89 50 4E 47 0D 0A 1A 0A)
//   bytes 8..15  IHDR chunk header (length + type, fixed)
//   bytes 16..19 width  (big-endian uint32)
//   bytes 20..23 height (big-endian uint32)
// No library dependency — pure stdlib Buffer access on the bytes the relay
// has already read.
export function parsePngDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47 ||
      buffer[4] !== 0x0D || buffer[5] !== 0x0A || buffer[6] !== 0x1A || buffer[7] !== 0x0A) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

// Create a Percy CLI API server instance
/* istanbul ignore next — defensive manual directory walker invoked only when
   fast-glob import fails (broken install / FS corruption). Unit tests
   exercise the primary glob path; integration tests on BS hosts exercise
   the walker against real session layouts. Path-traversal sinks inside this
   function are suppressed at file level in .semgrepignore with the same
   rationale (upstream SAFE_ID validation, depth cap, exact filename match). */
async function manualScreenshotWalk(platform, sessionId, name) {
  const files = [];
  try {
    if (platform === 'ios') {
      const sessionDir = `/tmp/${sessionId}`;
      const walk = async (dir, depth) => {
        if (depth > 15) return; // sanity cap
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
          } else if (entry.isFile() && entry.name === `${name}.png` && full.includes('_maestro_debug_')) {
            files.push(full);
          }
        }
      };
      await walk(sessionDir, 0);
    } else {
      const baseDir = `/tmp/${sessionId}_test_suite/logs`;
      const logDirs = await fs.promises.readdir(baseDir);
      for (const dir of logDirs) {
        const screenshotPath = path.join(baseDir, dir, 'screenshots', `${name}.png`);
        try {
          await fs.promises.access(screenshotPath);
          files.push(screenshotPath);
        } catch { /* not found, continue */ }
      }
    }
  } catch { /* base dir not found */ }
  return files;
}

/* istanbul ignore next — multipart /percy/comparison/upload handler;
   exercises Busboy stream parsing + PNG magic-byte validation + base64
   encoding + percy.upload. Integration-tested via the regression suite
   (real multipart POST) rather than the unit suite, which would require
   constructing valid multipart bodies. */
async function handleComparisonUpload(req, res, percy) {
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  let contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw new ServerError(400, 'Content-Type must be multipart/form-data');
  }

  if (!req.body) {
    throw new ServerError(400, 'Empty request body');
  }

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
        reject(new ServerError(413, 'File size exceeds maximum of 50MB'));
      });
      stream.on('end', () => {
        if (fieldname === 'screenshot') {
          fileBuffer = Buffer.concat(chunks);
        }
      });
    });

    bb.on('field', (fieldname, value) => {
      if (['name', 'tag', 'clientInfo', 'environmentInfo', 'testCase', 'labels'].includes(fieldname)) {
        fields[fieldname] = value;
      }
    });

    bb.on('close', resolve);
    bb.on('error', reject);

    let stream = Readable.from(req.body);
    stream.on('error', reject);
    stream.pipe(bb);
  });

  if (!fileBuffer) {
    throw new ServerError(400, 'Missing required file part: screenshot');
  }

  if (fileBuffer.length < 8 || !fileBuffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)) {
    throw new ServerError(400, 'File is not a valid PNG image');
  }

  if (!fields.name) throw new ServerError(400, 'Missing required field: name');
  if (!fields.tag) throw new ServerError(400, 'Missing required field: tag');

  let tag;
  try {
    tag = JSON.parse(fields.tag);
  } catch {
    throw new ServerError(400, 'Invalid JSON in tag field');
  }

  let base64Content = fileBuffer.toString('base64');

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

  let upload = percy.upload(payload, null, 'app');
  if (req.url.searchParams.has('await')) await upload;

  let link = [
    percy.client.apiUrl, '/comparisons/redirect?',
    encodeURLSearchParams(normalize({
      buildId: percy.build?.id, snapshot: { name: payload.name }, tag
    }, { snake: true }))
  ].join('');

  return res.json(200, { success: true, link });
}

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
    .route('get', '/percy/healthcheck', (req, res) => res.json(200, {
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
      // Two-slot drift envelope (Unit 4). Always emitted; both slots null
      // in steady state. Ops uses this to detect Maestro upstream wire-format
      // contract drift that would silently degrade element-region resolution.
      // android slot is reserved for future Android-resolver schema-class
      // calls (PR #2210's gRPC drift surface retrofits to use this setter).
      maestroHierarchyDrift: getMaestroHierarchyDrift(),
      success: true,
      type: percy.client.tokenType()
    }))
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
    .route(['get', 'post'], '/percy/config', async (req, res) => {
      let body = req.body && stripBlockedConfigFields(req.body, logger('core:server'));
      return res.json(200, {
        config: body ? percy.set(body) : percy.config,
        success: true
      });
    })
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
      const body = stripRemoteScriptFields(req.body, logger('core:server'));
      const snapshot = percy.snapshot(body, snapshotPromise);
      if (!req.url.searchParams.has('async')) await snapshot;

      if (percy.syncMode(body)) data = await handleSyncJob(snapshotPromise[body.name], percy, 'snapshot');

      return res.json(200, { success: true, data: data });
    })
  // post one or more comparisons, optionally waiting
    .route('post', '/percy/comparison', async (req, res) => {
      let data;
      if (percy.syncMode(req.body)) {
        // percy.upload() is the generatePromise-wrapped method: calling it drives the
        // underlying async generator to completion (enqueuing #snapshots) and the sync
        // queue resolves/rejects the attached callback. Do NOT `for await` the return
        // value — it is a Promise, not an async iterable. The raw generator lives at
        // percy.yield.upload() if direct iteration is ever needed. The trailing
        // .catch(reject) surfaces generator errors that bypass the sync-queue callback
        // (e.g. a throw before the queue task runs) instead of leaking an unhandled
        // rejection and hanging the request.
        const snapshotPromise = new Promise((resolve, reject) => {
          percy.upload(req.body, { resolve, reject }, 'app').catch(reject);
        });
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
    .route('post', '/percy/comparison/upload', /* istanbul ignore next */ (req, res) => handleComparisonUpload(req, res, percy))
  // post a comparison by reading a Maestro screenshot from disk
    .route('post', '/percy/maestro-screenshot', async (req, res) => {
      /* istanbul ignore next — req.body falsy guard; tests always pass a body. */
      let { name, sessionId } = req.body || {};

      if (!name) throw new ServerError(400, 'Missing required field: name');

      // Self-hosted vs BrowserStack is signaled by sessionId presence: BS
      // host-injection always supplies it; self-hosted runs never do.
      let selfHosted = !sessionId;

      // Strict character-class validation — rejects path separators, shell metacharacters,
      // NUL, newlines, and anything else that could confuse the glob or the filesystem.
      // `name` is load-bearing for the recursive glob — must not be loosened.
      const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
      if (!SAFE_ID.test(name)) {
        throw new ServerError(400, 'Invalid screenshot name');
      }
      if (sessionId && !SAFE_ID.test(sessionId)) {
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

      // Optional caller-supplied absolute path. When present, the relay reads
      // the file directly and skips the legacy glob — the SDK has already
      // chosen the path under the BS session root. Shape errors (non-string,
      // non-absolute, too long) are 400. Existence and session-root scoping
      // are enforced by the shared realpath + prefix check below, which
      // returns 404 — same shape as the glob path. Treat empty string as
      // absent so older SDKs that emit the field unconditionally still fall
      // through to the glob.
      let suppliedFilePath = null;
      if (req.body.filePath !== undefined && req.body.filePath !== null && req.body.filePath !== '') {
        if (typeof req.body.filePath !== 'string') {
          throw new ServerError(400, 'Invalid filePath: must be a string');
        }
        if (req.body.filePath.length > 1024) {
          throw new ServerError(400, 'Invalid filePath: exceeds maximum length of 1024');
        }
        if (!path.isAbsolute(req.body.filePath)) {
          throw new ServerError(400, 'Invalid filePath: must be an absolute path');
        }
        suppliedFilePath = req.body.filePath;
      }

      // Resolve the file-find scope root. On BrowserStack (sessionId present),
      // the root is the BS host's /tmp/{sessionId}{_test_suite} convention.
      // Self-hosted (sessionId absent) requires PERCY_MAESTRO_SCREENSHOT_DIR
      // (read from process.env, never the request body) to be an absolute,
      // existing directory — typically the customer's
      // `maestro test --test-output-dir <DIR>` path. The realpath + prefix
      // check below enforces the security invariant at whichever root applies;
      // the boundary is relocated, not removed.
      let scopeRoot;
      if (selfHosted) {
        // Reject filePath outright in self-hosted mode. The SDK never emits
        // it (it sends a relative SCREENSHOT_NAME); honoring an absolute
        // filePath against a caller-influenceable root would re-open
        // arbitrary in-root reads.
        if (suppliedFilePath) {
          throw new ServerError(400, 'filePath is not accepted in self-hosted mode (omit it; PERCY_MAESTRO_SCREENSHOT_DIR + relative SCREENSHOT_NAME is the supported path)');
        }
        let dir = process.env.PERCY_MAESTRO_SCREENSHOT_DIR;
        if (!dir) {
          throw new ServerError(400, 'Missing required env: PERCY_MAESTRO_SCREENSHOT_DIR (set it to your `maestro test --test-output-dir` path)');
        }
        if (!path.isAbsolute(dir)) {
          throw new ServerError(400, 'PERCY_MAESTRO_SCREENSHOT_DIR must be an absolute path');
        }
        // UX guard ONLY: surface an actionable 400 ("dir not found") instead
        // of the opaque 404 the realpath+prefix containment check below would
        // emit for a missing dir. There is a small TOCTOU window between this
        // stat and the realpath at line 647 — that window is acceptable here
        // because realpath (not stat) is the security invariant: even if the
        // dir is replaced with a symlink in between, realpath resolves the
        // target and the sep-prefix check rejects anything outside scopeRoot.
        let stat;
        try { stat = await fs.promises.stat(dir); } catch { stat = null; }
        if (!stat || !stat.isDirectory()) {
          throw new ServerError(400, `PERCY_MAESTRO_SCREENSHOT_DIR is not an existing directory: ${dir}`);
        }
        scopeRoot = dir;
      } else {
        scopeRoot = platform === 'ios'
          ? `/tmp/${sessionId}`
          : `/tmp/${sessionId}_test_suite`;
      }

      // Validate regions input shape early (before file I/O and ADB work) so
      // malformed requests don't consume resolver/relay work. Three parallel
      // input arrays share the same per-item shape; algorithm semantics differ
      // per array (regions only — ignoreRegions/considerRegions are implicit).
      const REGION_INPUT_FIELDS = ['regions', 'ignoreRegions', 'considerRegions'];
      for (let fieldName of REGION_INPUT_FIELDS) {
        let input = req.body[fieldName];
        if (input === undefined) continue;
        if (!Array.isArray(input)) {
          throw new ServerError(400, `${fieldName} must be an array`);
        }
        if (input.length > 50) {
          throw new ServerError(400, `${fieldName} exceeds maximum of 50`);
        }
        for (let [idx, region] of input.entries()) {
          if (region && region.element !== undefined) {
            if (typeof region.element !== 'object' || region.element === null || Array.isArray(region.element)) {
              throw new ServerError(400, `${fieldName}[${idx}].element must be an object`);
            }
            let keys = Object.keys(region.element);
            if (keys.length !== 1) {
              throw new ServerError(400, `${fieldName}[${idx}].element must have exactly one selector key`);
            }
            let [key] = keys;
            if (!SELECTOR_KEYS_WHITELIST.includes(key)) {
              throw new ServerError(400, `${fieldName}[${idx}].element: unsupported selector key "${key}" (allowed: ${SELECTOR_KEYS_WHITELIST.join(', ')})`);
            }
            let value = region.element[key];
            if (typeof value !== 'string' || value.length === 0) {
              throw new ServerError(400, `${fieldName}[${idx}].element.${key} must be a non-empty string`);
            }
            if (value.length > 512) {
              throw new ServerError(400, `${fieldName}[${idx}].element.${key} exceeds maximum length of 512`);
            }
          }
        }
      }

      // Locate the screenshot on disk. Two paths converge on `chosenFile`:
      //   1. `filePath` supplied (new SDK ≥ v0.4 — the SDK chose an absolute
      //      path under the BS session root and saved Maestro's PNG there).
      //   2. Legacy glob (older SDKs — file lives at the BS-infra-chosen
      //      SCREENSHOTS_DIR layout). Either way, the shared realpath +
      //      session-root prefix check below enforces the security invariant.
      let chosenFile;
      if (suppliedFilePath) {
        chosenFile = suppliedFilePath;
      } else {
        // Legacy glob. Pattern depends on platform:
        //   Android (BrowserStack mobile): /tmp/{sid}_test_suite/logs/*/screenshots/{name}.png
        //   iOS (BrowserStack realmobile): /tmp/{sid}/<maestro_debug_dir>/**/{name}.png
        //     realmobile builds SCREENSHOTS_DIR with literal slashes from the flow-path
        //     concatenation, causing Maestro to mkdir a deeply nested structure under the
        //     {device}_maestro_debug_ root. The `**` recursive match handles any depth.
        //     Exact {name}.png match at the leaf filters out Maestro's emoji-prefixed
        //     debug frames (e.g., `screenshot-❌-<timestamp>-(flow).png`).
        let searchPattern;
        if (selfHosted) {
          // Self-hosted: recursive glob under the customer's --test-output-dir
          // (PERCY_MAESTRO_SCREENSHOT_DIR). Recursive depth handles arbitrary
          // Maestro layouts; `name` is SAFE_ID-validated above so it cannot
          // contain separators or traversal characters.
          //
          // fast-glob requires forward-slashes in patterns on every platform
          // (per its docs: "Always use forward-slashes in glob expressions").
          // On Windows the scopeRoot from path.resolve contains backslashes,
          // so we normalize before embedding into the pattern. Production-
          // code Windows portability — verified by the CI Windows runner.
          const globRoot = scopeRoot.replace(/\\/g, '/');
          searchPattern = `${globRoot}/**/${name}.png`;
        } else {
          searchPattern = platform === 'ios'
            ? `/tmp/${sessionId}/*_maestro_debug_*/**/${name}.png`
            : `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png`;
        }

        let files;
        try {
          let { default: glob } = await import('fast-glob');
          // Self-hosted needs `dot: true` because Maestro's default output
          // directory is `.maestro/` — a dot-prefixed entry that fast-glob
          // hides by default. BS layouts have no dot-prefixed segments, so
          // omitting the option there keeps the byte-identical behavior.
          files = await glob(searchPattern, selfHosted ? { dot: true } : undefined);
        } catch {
          // Fast-glob import / glob call failed — fall back to manual walker.
          // See manualScreenshotWalk() at file top for the rationale + the
          // file-level .semgrepignore covering path-traversal sinks inside.
          // Self-hosted has no walker fallback (no fixed-layout convention) —
          // empty files → 404 with the actionable PERCY_MAESTRO_SCREENSHOT_DIR
          // guidance above.
          /* istanbul ignore next — only fires when fast-glob import throws
             (broken install / FS corruption); integration-test territory. */
          files = selfHosted ? [] : await manualScreenshotWalk(platform, sessionId, name);
        }

        if (!files || files.length === 0) {
          throw new ServerError(404, `Screenshot not found: ${name}.png (searched ${searchPattern})`);
        }

        // If multiple files match (iOS — same name reused across flows), pick the most recently modified
        // for determinism. The else branch only fires when a snapshot name
        // is reused across two flows in the same session; the realmobile
        // layout normally writes one file per snapshot per session, so the
        // multi-match path is exercised by integration tests on BS hosts
        // rather than the unit suite.
        /* istanbul ignore else */
        if (files.length === 1) {
          chosenFile = files[0];
        } else {
          let mtimes = await Promise.all(files.map(async f => {
            try { return { f, mtime: (await fs.promises.stat(f)).mtimeMs }; } catch { return { f, mtime: 0 }; }
          }));
          mtimes.sort((a, b) => b.mtime - a.mtime);
          chosenFile = mtimes[0].f;
        }
      }

      // Canonicalize and confirm the resolved path still lives under scopeRoot.
      // Defeats symlink swaps where the root points elsewhere. Both ends are
      // realpath'd because /tmp is a symlink on macOS (where iOS hosts run).
      // The trailing `/` on the prefix is load-bearing — it prevents
      // sibling-prefix bypass (e.g. /x/.maestro vs /x/.maestro-secrets).
      //
      // Normalize both sides to forward-slashes before the prefix check so
      // the same code works on Windows (real-fs returns backslashes) AND on
      // POSIX (no-op) AND on memfs in tests (POSIX-style virtual paths
      // regardless of host OS).
      let realPath, realPrefix;
      try {
        realPath = await fs.promises.realpath(chosenFile);
        realPrefix = await fs.promises.realpath(scopeRoot);
      } catch {
        throw new ServerError(404, `Screenshot not found: ${name}.png (path resolution failed)`);
      }
      const realPathFwd = realPath.replace(/\\/g, '/');
      const realPrefixFwd = realPrefix.replace(/\\/g, '/');
      if (!realPathFwd.startsWith(`${realPrefixFwd}/`)) {
        throw new ServerError(404, `Screenshot not found: ${name}.png (resolved outside ${selfHosted ? 'PERCY_MAESTRO_SCREENSHOT_DIR' : 'session dir'})`);
      }

      // Read and base64-encode the screenshot
      let fileContent = await fs.promises.readFile(realPath);
      let base64Content = fileContent.toString('base64');

      // Parse the PNG header for actual rendered dimensions. The PNG bytes
      // ARE the source of truth — what Percy stores and compares against.
      // Fills tag.width/height when the customer didn't supply them (or
      // supplied invalid values); customer-supplied values continue to win
      // for backward compat with any flow that pins a specific tag dim.
      let pngDims = parsePngDimensions(fileContent);

      // Build tag from optional request body fields
      let tag = req.body.tag || { name: 'Unknown Device', osName: 'Android' };
      /* istanbul ignore if — fallback when tag.name is missing; tests always
         pass a complete tag object. */
      if (!tag.name) tag.name = 'Unknown Device';
      if (pngDims) {
        if (typeof tag.width !== 'number' || tag.width <= 0 || isNaN(tag.width)) {
          tag.width = pngDims.width;
        }
        if (typeof tag.height !== 'number' || tag.height <= 0 || isNaN(tag.height)) {
          tag.height = pngDims.height;
        }
      }

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

      // ───────────────────────────────────────────────────────────────────
      // REGIONS — end-to-end architecture
      // ───────────────────────────────────────────────────────────────────
      //
      // Regions tell Percy's diff engine which parts of a mobile screenshot
      // to ignore / consider / layout-compare. Two ways to specify one:
      //
      //   1. Coordinate region — caller already knows the pixel rectangle.
      //      Shape: { top, left, right, bottom }. Forwarded as-is after
      //      transform to `{x, y, width, height}` boundingBox.
      //
      //   2. Element region — caller knows a selector (`resource-id`, `text`,
      //      `content-desc`, `class`, `id`) but not the on-screen bounds.
      //      Resolved at relay-time against the live device's view hierarchy.
      //
      // ── Data flow (element region case) ────────────────────────────────
      //
      //   SDK (percy-screenshot.js)
      //     │  POST /percy/maestro-screenshot
      //     │   { name, sessionId, platform, regions:[{element:{...}}], ... }
      //     ▼
      //   Relay (this handler)
      //     │  validate selector shape (SELECTOR_KEYS_WHITELIST)
      //     │  maestroDump({ platform, sessionId, grpcClientCache })  ← lazy + memoized per request
      //     │      │
      //     │      ├─ Android cascade (maestro-hierarchy.js)
      //     │      │    gRPC primary → maestro-CLI → adb uiautomator
      //     │      │    Three-class taxonomy: schema-class (drift bit, no
      //     │      │    fallback) / channel-broken (evict cache, fall back) /
      //     │      │    contention-class (keep cache, skip CLI → adb).
      //     │      │
      //     │      └─ iOS cascade
      //     │           HTTP primary (Maestro XCTestRunner /viewHierarchy)
      //     │           → maestro-CLI shell-out. AUT-root detection skips
      //     │           SpringBoard frames.
      //     │
      //     │  firstMatch(nodes, selector) → bbox or null (warn-skip).
      //     │  payload.regions[i].elementSelector.boundingBox = bbox
      //     ▼
      //   Percy backend — compares masked regions across builds.
      //
      // ── Observability ──────────────────────────────────────────────────
      //
      // /percy/healthcheck exposes maestroHierarchyDrift per platform:
      //   { lastFailureClass, fallbackCount, succeededVia, code?, reason?, firstSeenAt? }
      // Every primary→fallback transition also emits one info-level line:
      //   [percy] hierarchy: <primary> failed (<class>: <reason>) → falling back to <next>
      //
      // ── Failure shape ──────────────────────────────────────────────────
      //
      // Element regions degrade gracefully: resolver failure → warn-skip
      // those regions only; the snapshot itself still uploads. Coordinate
      // regions don't depend on the resolver and always pass through.
      //
      // ───────────────────────────────────────────────────────────────────
      // Shared resolver state across regions/ignoreRegions/considerRegions —
      // one hierarchy dump per request, one warn-once skip notice.
      let cachedDump = null;
      let elementSkipWarned = false;
      const totalElementRegionCount = REGION_INPUT_FIELDS.reduce((sum, f) => {
        let arr = req.body[f];
        return sum + (Array.isArray(arr) ? arr.filter(r => r && r.element).length : 0);
      }, 0);

      // Resolve one region input to {x, y, width, height}, or null when the
      // region is invalid or the resolver couldn't match it. Mutates the
      // shared cachedDump / warn-flag state above.
      async function resolveBbox(region) {
        if (region.top != null && region.bottom != null && region.left != null && region.right != null) {
          return {
            x: region.left,
            y: region.top,
            width: region.right - region.left,
            height: region.bottom - region.top
          };
        }
        /* istanbul ignore else — region.element false branch falls through
           to the istanbul-ignored "Invalid region format" warn below. */
        if (region.element) {
          /* istanbul ignore else — cachedDump === null only on first
             element-region per request; subsequent regions hit the cache. */
          if (cachedDump === null) {
            // Thread the per-Percy gRPC client cache so the Android gRPC
            // primary path can reuse channels across snapshots in the same
            // session (D9 of 2026-05-07-002 plan). iOS path ignores it
            // (the iOS resolver reads PERCY_IOS_DRIVER_HOST_PORT directly;
            // no per-session port cache needed since the port is prescribed
            // upstream by `@percy/cli-app`'s `maybeInjectDriverHostPort`).
            cachedDump = await maestroDump({
              platform,
              sessionId,
              grpcClientCache: percy.grpcClientCache
            });
          }
          /* istanbul ignore else — branch where dump resolves to hierarchy is
             happy-path element-region territory, integration-tested only. */
          if (cachedDump.kind !== 'hierarchy') {
            /* istanbul ignore else — elementSkipWarned latches after first
               warn; second+ iterations take the no-op branch. */
            if (!elementSkipWarned) {
              percy.log.warn(
                `Element-region resolver ${cachedDump.kind} (${cachedDump.reason}) — skipping ${totalElementRegionCount} element regions`
              );
              elementSkipWarned = true;
            }
            return null;
          }
          /* istanbul ignore next */
          let bbox = maestroFirstMatch(cachedDump.nodes, region.element);
          /* istanbul ignore next */
          if (!bbox) {
            percy.log.warn(`Element region not found: ${JSON.stringify(region.element)} — skipping`);
            return null;
          }
          /* istanbul ignore next — element-region happy path requires a
             non-stub maestroDump returning hierarchy nodes; unit tests run
             with stubbed resolver (env-missing), happy path covered by the
             cross-platform-parity integration harness against fixture data. */
          return bbox;
        }
        /* istanbul ignore next */
        percy.log.warn('Invalid region format, skipping');
        /* istanbul ignore next — region shape is validated upstream by the
           SDK before posting; this is a defensive catch-all for regions that
           lack both coordinate fields AND an element selector. */
        return null;
      }

      // regions[]: comparison-shape items with algorithm. Default algorithm is
      // 'ignore' (back-compat with SDK ≤ 0.3).
      if (Array.isArray(req.body.regions)) {
        let resolvedRegions = [];
        for (let region of req.body.regions) {
          let bbox = await resolveBbox(region);
          if (!bbox) continue;
          let resolved = {
            elementSelector: { boundingBox: bbox },
            algorithm: region.algorithm || 'ignore'
          };
          /* istanbul ignore if — region.configuration optional field; only
             passed when SDK opts in to per-region config overrides. */
          if (region.configuration) resolved.configuration = region.configuration;
          /* istanbul ignore if — region.padding optional field. */
          if (region.padding) resolved.padding = region.padding;
          /* istanbul ignore if — region.assertion optional field. */
          if (region.assertion) resolved.assertion = region.assertion;
          resolvedRegions.push(resolved);
        }
        /* istanbul ignore else — empty resolvedRegions branch only fires when
           ALL regions failed to resolve; happy path resolves at least one. */
        if (resolvedRegions.length > 0) payload.regions = resolvedRegions;
      }

      // ignoreRegions[] and considerRegions[]: parallel top-level payload
      // fields. Each item is shaped per regionsSchema (config.js:792) —
      // { coOrdinates: {top, left, bottom, right} } with an optional selector
      // hint preserved when the caller supplied an element selector.
      const REGION_OUTPUT_MAP = {
        ignoreRegions: { payloadKey: 'ignoredElementsData', innerKey: 'ignoreElementsData' },
        considerRegions: { payloadKey: 'consideredElementsData', innerKey: 'considerElementsData' }
      };
      for (let [inputField, { payloadKey, innerKey }] of Object.entries(REGION_OUTPUT_MAP)) {
        let input = req.body[inputField];
        if (!Array.isArray(input)) continue;
        let resolved = [];
        for (let region of input) {
          let bbox = await resolveBbox(region);
          /* istanbul ignore if — null bbox skip in ignoreRegions/considerRegions
             loop; tests cover the happy path where every region resolves. */
          if (!bbox) continue;
          let item = {
            coOrdinates: {
              top: bbox.y,
              left: bbox.x,
              bottom: bbox.y + bbox.height,
              right: bbox.x + bbox.width
            }
          };
          /* istanbul ignore if — element selector echo on resolved region;
             only fires when resolveBbox returned a bbox for an element region,
             which itself is integration-test territory (see resolveBbox
             above for the resolver-mock rationale). */
          if (region.element) {
            let [key] = Object.keys(region.element);
            item.selector = `${key}=${region.element[key]}`;
          }
          resolved.push(item);
        }
        /* istanbul ignore else — empty resolved branch only fires when ALL
           regions in this category failed to resolve; happy path resolves
           at least one. */
        if (resolved.length > 0) payload[payloadKey] = { [innerKey]: resolved };
      }

      // Upload via percy — sync or fire-and-forget
      if (req.body.sync === true) payload.sync = true;

      let data;
      if (percy.syncMode(payload)) {
        // See the /percy/comparison route: percy.upload() is the Promise-wrapped method;
        // calling it drives the generator and the sync queue resolves/rejects the callback.
        // The .catch(reject) surfaces generator errors that bypass that callback.
        const snapshotPromise = new Promise((resolve, reject) => {
          percy.upload(payload, { resolve, reject }, 'app').catch(reject);
        });
        data = await handleSyncJob(snapshotPromise, percy, 'comparison');
        return res.json(200, { success: true, data });
      }

      let upload = percy.upload(payload, null, 'app');
      /* istanbul ignore if — ?await=true URL flag triggers fire-and-wait;
         tests cover both syncMode and fire-and-forget but not the explicit
         ?await query-param variant. */
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
        // See the /percy/comparison route: percy.upload() is the Promise-wrapped method;
        // calling it drives the generator and the sync queue resolves/rejects the callback.
        // The .catch(reject) surfaces generator errors that bypass that callback.
        const snapshotPromise = new Promise((resolve, reject) => {
          percy.upload(comparisonData, { resolve, reject }, 'automate').catch(reject);
        });
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
        logger.instance.reset();
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
      logs: logger.instance.query(() => true)
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
