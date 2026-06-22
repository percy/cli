import fs from 'fs';
import path from 'path';
import { normalize } from '@percy/config/utils';
import { ServerError } from './server.js';
import { encodeURLSearchParams } from './utils.js';
import { handleSyncJob } from './snapshot.js';
import { locateScreenshot } from './maestro-screenshot-file.js';
import { validateRegionInputs, resolveRegions } from './maestro-regions.js';
import { deriveDeviceInsets } from './maestro-hierarchy.js';

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

// Handler for `post /percy/maestro-screenshot`: post a comparison by reading
// a Maestro screenshot from disk.
export async function handleMaestroScreenshot(req, res, percy) {
  /* istanbul ignore next — req.body falsy guard; tests always pass a body. */
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

  // Validate regions input shape early (before file I/O and ADB work) so
  // malformed requests don't consume resolver/relay work.
  validateRegionInputs(req.body);

  // Locate the screenshot on disk (supplied filePath or legacy glob) and
  // confirm it resolves under the sessionId-owned dir. Throws ServerError(404)
  // when the file is missing or escapes the session root.
  let realPath = await locateScreenshot({ platform, sessionId, name, filePath: suppliedFilePath });

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

  // Derive exact device system-bar insets (pixels), once per session — they're
  // device-constant, so the first snapshot pays one /viewHierarchy (iOS) or
  // `dumpsys` (Android) call and the rest reuse the cached result (incl. a null
  // "use SDK default" outcome). CLI-derived values are authoritative over the
  // SDK's static defaults (those are SDK internal constants, not customer-set);
  // any derivation failure falls back to the SDK value. iOS navBarHeight is
  // always 0 — the home indicator is static and unmeasured, fleet-consistent.
  let insets = percy.maestroInsetCache.get(sessionId);
  if (insets === undefined) {
    insets = await deriveDeviceInsets({ platform, sessionId, pngDims });
    percy.maestroInsetCache.set(sessionId, insets);
    percy.log.debug(`maestro device insets (${platform}): ${insets ? 'derived' : 'fallback'}`);
  }
  let statusBarHeight = insets?.statusBarHeight ?? (req.body.statusBarHeight || 0);
  let navBarHeight = platform === 'ios'
    ? 0
    : (insets?.navBarHeight ?? (req.body.navBarHeight || 0));

  // Construct comparison payload with tile metadata from request
  let payload = {
    name,
    tag,
    tiles: [{
      content: base64Content,
      statusBarHeight,
      navBarHeight,
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

  // Resolve element/coordinate regions to comparison-payload fragments.
  // Element regions degrade gracefully — a resolver failure warn-skips those
  // regions only; the snapshot still uploads. The hierarchy dump is memoized
  // per request inside resolveRegions. Assign the three known comparison keys
  // explicitly (never Object.assign of request-derived data) so only these
  // fields can ever be set here.
  let regionData = await resolveRegions({ body: req.body, platform, sessionId, percy });
  if (regionData.regions) payload.regions = regionData.regions;
  if (regionData.ignoredElementsData) payload.ignoredElementsData = regionData.ignoredElementsData;
  if (regionData.consideredElementsData) payload.consideredElementsData = regionData.consideredElementsData;

  // Upload via percy — sync or fire-and-forget
  if (req.body.sync === true) payload.sync = true;

  let data;
  if (percy.syncMode(payload)) {
    // percy.upload returns an async generator that must be drained for #snapshots.push to run.
    // See docs/solutions/best-practices/2026-05-20-maestro-sync-promise-bug-investigation.md.
    const snapshotPromise = new Promise((resolve, reject) => {
      const upload = percy.upload(payload, { resolve, reject }, 'app');
      (async () => {
        // eslint-disable-next-line no-unused-vars
        try { for await (const _ of upload) { /* drain */ } } catch (e) { reject(e); }
      })();
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
}
