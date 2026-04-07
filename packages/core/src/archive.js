import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ARCHIVE_VERSION = 1;
const MAX_FILENAME_LENGTH = 200;
const UNSAFE_CHARS = /[/\\:*?"<>|]/g;

// Snapshot fields that should be archived (serializable metadata)
const SNAPSHOT_FIELDS = [
  'name', 'url', 'widths', 'minHeight', 'domSnapshot', 'percyCSS',
  'enableJavaScript', 'cliEnableJavaScript', 'disableShadowDOM',
  'scope', 'scopeOptions', 'testCase', 'labels', 'sync',
  'responsiveSnapshotCapture', 'discovery'
];

// Validates the archive path to prevent path traversal attacks.
// Returns the resolved absolute path.
export function validateArchivePath(archivePath) {
  let resolved = path.resolve(archivePath);
  let normalized = path.normalize(resolved);

  // Reject if the normalized path still contains '..' segments
  if (normalized.split(path.sep).includes('..')) {
    throw new Error(`Invalid archive path: path traversal detected in "${archivePath}"`);
  }

  return resolved;
}

// Sanitizes a snapshot name into a safe filename.
// Strips unsafe characters and appends a hash to prevent collisions.
export function sanitizeFilename(name) {
  let safe = name.replace(UNSAFE_CHARS, '_');

  if (safe.length > MAX_FILENAME_LENGTH) {
    safe = safe.substring(0, MAX_FILENAME_LENGTH);
  }

  // Append a short hash of the original name for collision prevention
  let hash = crypto.createHash('sha256').update(name).digest('hex').substring(0, 8);
  return `${safe}-${hash}`;
}

// Serializes a snapshot into a JSON-safe object for archiving.
// Resources have their binary content base64-encoded.
export function serializeSnapshot(snapshot) {
  let snapshotData = {};

  for (let field of SNAPSHOT_FIELDS) {
    if (snapshot[field] !== undefined) {
      snapshotData[field] = snapshot[field];
    }
  }

  let resources = [];

  if (Array.isArray(snapshot.resources)) {
    for (let resource of snapshot.resources) {
      resources.push({
        url: resource.url,
        sha: resource.sha,
        mimetype: resource.mimetype,
        root: resource.root || false,
        widths: resource.widths,
        log: resource.log || false,
        provided: resource.provided || false,
        content: resource.content
          ? Buffer.from(resource.content).toString('base64')
          : null
      });
    }
  }

  return {
    version: ARCHIVE_VERSION,
    snapshot: snapshotData,
    resources
  };
}

// Validates and deserializes an archived snapshot from parsed JSON.
// Decodes base64 resource content back to Buffers.
export function deserializeSnapshot(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid archive: expected an object');
  }

  if (data.version !== ARCHIVE_VERSION) {
    throw new Error(`Unsupported archive version: ${data.version} (expected ${ARCHIVE_VERSION})`);
  }

  if (!data.snapshot || typeof data.snapshot.name !== 'string' || !data.snapshot.name) {
    throw new Error('Invalid archive: missing snapshot name');
  }

  if (!Array.isArray(data.resources) || data.resources.length === 0) {
    throw new Error('Invalid archive: missing or empty resources');
  }

  let resources = [];

  for (let resource of data.resources) {
    if (!resource.url || !resource.sha || !resource.mimetype) {
      throw new Error(`Invalid resource: missing required fields (url, sha, mimetype)`);
    }

    resources.push({
      url: resource.url,
      sha: resource.sha,
      mimetype: resource.mimetype,
      root: resource.root || false,
      widths: resource.widths,
      log: resource.log || false,
      provided: resource.provided || false,
      content: resource.content ? Buffer.from(resource.content, 'base64') : null
    });
  }

  return {
    ...data.snapshot,
    resources
  };
}

// Archives a single snapshot to the archive directory.
// Creates the directory if it doesn't exist.
export function archiveSnapshot(archivePath, snapshot) {
  fs.mkdirSync(archivePath, { recursive: true });

  let filename = sanitizeFilename(snapshot.name);
  let filepath = path.join(archivePath, `${filename}.json`);
  let serialized = serializeSnapshot(snapshot);

  fs.writeFileSync(filepath, JSON.stringify(serialized));
}

// Reads all archived snapshots from the given directory.
// Skips symlinks and invalid files with warnings.
export function readArchivedSnapshots(archivePath, log) {
  let resolved = validateArchivePath(archivePath);

  if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isDirectory()) {
    throw new Error(`Archive directory not found: ${archivePath}`);
  }

  let entries = fs.readdirSync(resolved);
  let snapshots = [];

  for (let entry of entries) {
    if (!entry.endsWith('.json')) continue;

    let filepath = path.join(resolved, entry);
    let stat = fs.lstatSync(filepath);

    // Skip symlinks for security
    if (stat.isSymbolicLink()) {
      log?.warn(`Skipping symlink: ${entry}`);
      continue;
    }

    if (!stat.isFile()) continue;

    try {
      let raw = fs.readFileSync(filepath, 'utf-8');
      let data = JSON.parse(raw);
      let snapshot = deserializeSnapshot(data);
      snapshots.push(snapshot);
    } catch (error) {
      log?.warn(`Skipping invalid archive file "${entry}": ${error.message}`);
    }
  }

  return snapshots;
}
