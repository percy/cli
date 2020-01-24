import os from 'os';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { sha256hash } from '@percy/client/dist/utils';
import assert from './assert';
import readableBytes from './bytes';

const MAX_FILE_SIZE_BYTES = 15728640; // 15mb
const TEMP_DIR = path.join(os.tmpdir(), 'percy');

// Creates a local resource object containing the resource URL, SHA, mimetype,
// and local filepath in the OS temp directory. If the file does not exist, it
// is created unless it exceeds the file size limit.
export function createLocalResource(url, content, mimetype, log) {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR);

  let sha = sha256hash(content);
  let filepath = path.join(TEMP_DIR, sha);

  if (!existsSync(filepath)) {
    log?.();

    assert(content.length < MAX_FILE_SIZE_BYTES, 'too many bytes', {
      size: readableBytes(content.length)
    });

    writeFileSync(filepath, content);
  }

  return { url, sha, filepath, mimetype };
}

// Creates a root resource object containing the URL, SHA, content, and mimetype
// with an additional `root: true` property.
export function createRootResource(url, content) {
  return {
    url,
    content,
    sha: sha256hash(content),
    mimetype: 'text/html',
    root: true
  };
}
