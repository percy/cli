import fs from 'fs';
import PercyEnv from '@percy/env';
import { git } from '@percy/env/utils';
import logger from '@percy/logger';
import Pako from 'pako';

import {
  pool,
  request,
  formatBytes,
  sha256hash,
  base64encode,
  getPackageJSON,
  waitForTimeout,
  validateTiles,
  formatLogErrors,
  tagsList,
  normalizeBrowsers
} from './utils.js';

// Default client API URL can be set with an env var for API development
const { PERCY_CLIENT_API_URL = 'https://percy.io/api/v1' } = process.env;
let pkg = getPackageJSON(import.meta.url);
// minimum polling interval milliseconds
const MIN_POLLING_INTERVAL = 1_000;
const INVALID_TOKEN_ERROR_MESSAGE = 'Unable to retrieve snapshot details with write access token. Kindly use a full access token for retrieving snapshot details with Synchronous CLI.';

// Validate ID arguments
function validateId(type, id) {
  if (!id) throw new Error(`Missing ${type} ID`);
  if (!(typeof id === 'string' || typeof id === 'number')) {
    throw new Error(`Invalid ${type} ID`);
  }
}

function makeRegions(regions, algorithm, algorithmConfiguration) {
  let regionObj;

  if (algorithm) {
    regionObj = {};
    regionObj.algorithm = algorithm;
    regionObj.configuration = algorithmConfiguration;
  }
  if (!Array.isArray(regions) && !regionObj) return null;

  if (regionObj) {
    regions ||= [];
    regions.push(regionObj);
  }

  return regions.map(region => ({
    ...region,
    elementSelector: region.elementSelector || { fullpage: true }
  }));
}

// Validate project path arguments
function validateProjectPath(path) {
  if (!path) throw new Error('Missing project path');
  if (!/^[^/]+?\/.+/.test(path)) {
    throw new Error(`Invalid project path. Expected "org/project" but received "${path}"`);
  }
}

// PercyClient is used to communicate with the Percy API to create and finalize
// builds and snapshot. Uses @percy/env to collect environment information used
// during build creation.
export class PercyClient {
  log = logger('client');
  env = new PercyEnv(process.env);
  clientInfo = new Set();
  environmentInfo = new Set();

  constructor({
    // read or write token, defaults to PERCY_TOKEN environment variable
    token,
    // initial user agent info
    clientInfo,
    environmentInfo,
    config,
    labels,
    // versioned api url
    apiUrl = PERCY_CLIENT_API_URL
  } = {}) {
    Object.assign(this, { token, config: config || {}, apiUrl, labels: labels });
    this.addClientInfo(clientInfo);
    this.addEnvironmentInfo(environmentInfo);
    this.buildType = null;
    this.screenshotFlow = null;
  }

  // Adds additional unique client info.
  addClientInfo(info) {
    for (let i of [].concat(info)) {
      if (i) this.clientInfo.add(i);
    }
  }

  // Adds additional unique environment info.
  addEnvironmentInfo(info) {
    for (let i of [].concat(info)) {
      if (i) this.environmentInfo.add(i);
    }
  }

  // Stringifies client and environment info.
  userAgent() {
    // forcedPkgValue has been added since when percy package is bundled inside Electron app (LCNC)
    // we can't read Percy's package json for package name and version, so we are passing it via env variables
    if (this.env.forcedPkgValue) pkg = this.env.forcedPkgValue;

    let client = new Set([`Percy/${/\w+$/.exec(this.apiUrl)}`]
      .concat(`${pkg.name}/${pkg.version}`, ...this.clientInfo)
      .filter(Boolean));
    let environment = new Set([...this.environmentInfo]
      .concat(`node/${process.version}`, this.env.info)
      .filter(Boolean));

    return `${[...client].join(' ')} (${[...environment].join('; ')})`;
  }

  // Checks for a Percy token and returns it.
  // Priority order is
  // 1. passed token to constructor
  // 2. PERCY_TOKEN env var [ from env package ]
  // 3. token from percy config
  getToken(raiseIfMissing = true) {
    let token = this.token || this.env.token || this.config.percy?.token;
    if (!token && raiseIfMissing) throw new Error('Missing Percy token');
    return token;
  }

  // Returns common headers used for each request with additional
  // headers. Throws an error when the token is missing, which is a required
  // authorization header.
  headers(headers, raiseIfMissing = true) {
    return Object.assign({
      Authorization: `Token token=${this.getToken(raiseIfMissing)}`,
      'User-Agent': this.userAgent()
    }, headers);
  }

  // Performs a GET request for an API endpoint with appropriate headers.
  // we create a copy of meta as we update it in request and we wont want those updates
  // to go back to caller - should be only limited to current function
  get(path, { ...meta } = {}) {
    return logger.measure('client:get', meta.identifier, meta, () => {
      return request(`${this.apiUrl}/${path}`, {
        headers: this.headers(),
        method: 'GET',
        meta
      });
    });
  }

  // Performs a POST request to a JSON API endpoint with appropriate headers.
  post(path, body = {}, { ...meta } = {}, customHeaders = {}, raiseIfMissing = true) {
    return logger.measure('client:post', meta.identifier || 'Unknown', meta, () => {
      return request(`${this.apiUrl}/${path}`, {
        headers: this.headers({
          'Content-Type': 'application/vnd.api+json',
          ...customHeaders
        }, raiseIfMissing),
        method: 'POST',
        body,
        meta
      });
    });
  }

  // Creates a build with optional build resources. Only one build can be
  // created at a time per instance so snapshots and build finalization can be
  // done more seemlessly without manually tracking build ids
  async createBuild({ resources = [], projectType, cliStartTime = null } = {}) {
    this.log.debug('Creating a new build...');
    let source = 'user_created';

    if (process.env.PERCY_ORIGINATED_SOURCE) {
      source = 'bstack_sdk_created';
    } else if (process.env.PERCY_AUTO_ENABLED_GROUP_BUILD === 'true') {
      source = 'auto_enabled_group';
    }

    let tagsArr = tagsList(this.labels);

    return this.post('builds', {
      data: {
        type: 'builds',
        attributes: {
          type: projectType,
          branch: this.env.git.branch,
          'target-branch': this.env.target.branch,
          'target-commit-sha': this.env.target.commit,
          'commit-sha': this.env.git.sha,
          'commit-committed-at': this.env.git.committedAt,
          'commit-author-name': this.env.git.authorName,
          'commit-author-email': this.env.git.authorEmail,
          'commit-committer-name': this.env.git.committerName,
          'commit-committer-email': this.env.git.committerEmail,
          'commit-message': this.env.git.message,
          'pull-request-number': this.env.pullRequest,
          'parallel-nonce': this.env.parallel.nonce,
          'parallel-total-shards': this.env.parallel.total,
          partial: this.env.partial,
          tags: tagsArr,
          'cli-start-time': cliStartTime,
          source: source,
          'skip-base-build': this.config.percy?.skipBaseBuild,
          'testhub-build-uuid': this.env.testhubBuildUuid
        },
        relationships: {
          resources: {
            data: resources.map(r => ({
              type: 'resources',
              id: r.sha || sha256hash(r.content),
              attributes: {
                'resource-url': r.url,
                'is-root': r.root || null,
                mimetype: r.mimetype || null
              }
            }))
          }
        }
      }
    });
  }

  // Finalizes the active build. When `all` is true, `all-shards=true` is
  // added as a query param so the API finalizes all other build shards.
  async finalizeBuild(buildId, { all = false } = {}) {
    validateId('build', buildId);
    let qs = all ? 'all-shards=true' : '';
    this.log.debug(`Finalizing build ${buildId}...`);
    return this.post(`builds/${buildId}/finalize?${qs}`, {}, { identifier: 'build.finalze' });
  }

  // Retrieves build data by id. Requires a read access token.
  async getBuild(buildId) {
    validateId('build', buildId);
    this.log.debug(`Get build ${buildId}`);
    return this.get(`builds/${buildId}`);
  }

  async getComparisonDetails(comparisonId) {
    validateId('comparison', comparisonId);
    try {
      return await this.get(`comparisons/${comparisonId}?sync=true&response_format=sync-cli`);
    } catch (error) {
      this.log.error(error);
      if (error.response.statusCode === 403) {
        throw new Error(INVALID_TOKEN_ERROR_MESSAGE);
      }
      throw error;
    }
  }

  async getSnapshotDetails(snapshotId) {
    validateId('snapshot', snapshotId);
    try {
      return await this.get(`snapshots/${snapshotId}?sync=true&response_format=sync-cli`);
    } catch (error) {
      this.log.error(error);
      if (error.response.statusCode === 403) {
        throw new Error(INVALID_TOKEN_ERROR_MESSAGE);
      }
      throw error;
    }
  }

  // Retrieves snapshot/comparison data by id. Requires a read access token.
  async getStatus(type, ids) {
    if (!['snapshot', 'comparison'].includes(type)) throw new Error('Invalid type passed');
    this.log.debug(`Getting ${type} status for ids ${ids}`);
    return this.get(`job_status?sync=true&type=${type}&id=${ids.join()}`);
  }

  // Returns device details enabled on project associated with given token
  async getDeviceDetails(buildId) {
    try {
      let url = 'discovery/device-details';
      if (buildId) url += `?build_id=${buildId}`;
      const { data } = await this.get(url);
      return data;
    } catch (e) {
      return [];
    }
  }

  // Retrieves project builds optionally filtered. Requires a read access token.
  async getBuilds(project, filters = {}) {
    validateProjectPath(project);

    let qs = Object.keys(filters).map(k => (
      Array.isArray(filters[k])
        ? filters[k].map(v => `filter[${k}][]=${v}`).join('&')
        : `filter[${k}]=${filters[k]}`
    )).join('&');

    this.log.debug(`Fetching builds for ${project}`);
    return this.get(`projects/${project}/builds?${qs}`);
  }

  // Resolves when the build has finished and is no longer pending or
  // processing. By default, will time out if no update after 10 minutes.
  waitForBuild({
    build,
    project,
    commit,
    timeout = 10 * 60 * 1000,
    interval = 10_000
  }, onProgress) {
    if (interval < MIN_POLLING_INTERVAL) {
      this.log.warn(`Ignoring interval since it cannot be less than ${MIN_POLLING_INTERVAL}ms.`);
      interval = MIN_POLLING_INTERVAL;
    }
    if (!project && commit) {
      throw new Error('Missing project path for commit');
    } else if (!project && !build) {
      throw new Error('Missing project path or build ID');
    } else if (project) {
      validateProjectPath(project);
    }

    commit ||= this.env.git.sha;
    if (!build && !commit) throw new Error('Missing build commit');
    let sha = commit && (git(`rev-parse ${commit}`) || commit);

    let fetchData = async () => build
      ? (await this.getBuild(build)).data
      : (await this.getBuilds(project, { sha })).data?.[0];

    this.log.debug(`Waiting for build ${build || `${project} (${commit})`}...`);

    // recursively poll every second until the build finishes
    return new Promise((resolve, reject) => (async function poll(last, t) {
      try {
        let data = await fetchData();
        let state = data?.attributes.state;
        let pending = !state || state === 'pending' || state === 'processing';
        let updated = JSON.stringify(data) !== JSON.stringify(last);

        // new data received
        if (updated) {
          t = Date.now();

        // no new data within the timeout
        } else if (Date.now() - t >= timeout) {
          throw new Error(state == null ? 'Build not found' : 'Timeout exceeded with no updates');
        }

        // call progress every update after the first update
        if ((last || pending) && updated) {
          onProgress?.(data);
        }

        // not finished, poll again
        if (pending) {
          return setTimeout(poll, interval, data, t);

        // build finished
        } else {
          // ensure progress is called at least once
          if (!last) onProgress?.(data);
          resolve({ data });
        }
      } catch (err) {
        reject(err);
      }
    })(null, Date.now()));
  }

  // Uploads a single resource to the active build. If `filepath` is provided,
  // `content` is read from the filesystem. The sha is optional and will be
  // created from `content` if one is not provided.
  async uploadResource(buildId, { url, sha, filepath, content } = {}, meta = {}) {
    validateId('build', buildId);
    if (filepath) {
      content = await fs.promises.readFile(filepath);
      if (process.env.PERCY_GZIP) {
        content = Pako.gzip(content);
      }
    }
    let encodedContent = base64encode(content);

    this.log.debug(`Uploading ${formatBytes(encodedContent.length)} resource: ${url}`, meta);
    this.mayBeLogUploadSize(encodedContent.length, meta);

    return this.post(`builds/${buildId}/resources`, {
      data: {
        type: 'resources',
        id: sha || sha256hash(content),
        attributes: {
          'base64-content': encodedContent
        }
      }
    }, { identifier: 'resource.post', ...meta });
  }

  // Uploads resources to the active build concurrently, two at a time.
  async uploadResources(buildId, resources, meta = {}) {
    validateId('build', buildId);
    this.log.debug(`Uploading resources for ${buildId}...`, meta);

    const uploadConcurrency = parseInt(process.env.PERCY_RESOURCE_UPLOAD_CONCURRENCY) || 2;
    return pool(function*() {
      for (let resource of resources) {
        let resourceMeta = {
          url: resource.url,
          sha: resource.sha,
          ...meta
        };
        yield this.uploadResource(buildId, resource, resourceMeta).then((result) => {
          this.log.debug(`Uploaded resource ${resource.url}`, resourceMeta);
          return result;
        });
      }
    }, this, uploadConcurrency);
  }

  // Creates a snapshot for the active build using the provided attributes.
  async createSnapshot(buildId, {
    name,
    widths,
    scope,
    scopeOptions,
    minHeight,
    enableJavaScript,
    enableLayout,
    clientInfo,
    environmentInfo,
    sync,
    testCase,
    labels,
    thTestCaseExecutionId,
    browsers,
    regions,
    algorithm,
    algorithmConfiguration,
    resources = [],
    meta
  } = {}) {
    validateId('build', buildId);
    this.addClientInfo(clientInfo);
    this.addEnvironmentInfo(environmentInfo);

    if (!this.clientInfo.size || !this.environmentInfo.size) {
      this.log.warn('Warning: Missing `clientInfo` and/or `environmentInfo` properties', meta);
    }

    let tagsArr = tagsList(labels);
    let regionsArr = makeRegions(regions, algorithm, algorithmConfiguration);

    this.log.debug(`Validating resources: ${name}...`, meta);
    for (let resource of resources) {
      if (resource.sha || resource.content || !resource.filepath) continue;
      resource.content = await fs.promises.readFile(resource.filepath);
    }

    this.log.debug(`Creating snapshot: ${name}...`, meta);

    return this.post(`builds/${buildId}/snapshots`, {
      data: {
        type: 'snapshots',
        attributes: {
          name: name || null,
          widths: widths || null,
          scope: scope || null,
          sync: !!sync,
          'test-case': testCase || null,
          tags: tagsArr,
          'scope-options': scopeOptions || {},
          regions: regionsArr || null,
          'minimum-height': minHeight || null,
          'enable-javascript': enableJavaScript || null,
          'enable-layout': enableLayout || false,
          'th-test-case-execution-id': thTestCaseExecutionId || null,
          browsers: normalizeBrowsers(browsers) || null
        },
        relationships: {
          resources: {
            data: resources.map(r => ({
              type: 'resources',
              id: r.sha ?? (r.content && sha256hash(r.content)),
              attributes: {
                'resource-url': r.url || null,
                'is-root': r.root || null,
                'for-widths': r.widths || null,
                mimetype: r.mimetype || null
              }
            }))
          }
        }
      }
    }, { identifier: 'snapshot.post', ...meta });
  }

  // Finalizes a snapshot.
  async finalizeSnapshot(snapshotId, meta = {}) {
    validateId('snapshot', snapshotId);
    this.log.debug(`Finalizing snapshot ${snapshotId}...`, meta);
    return this.post(`snapshots/${snapshotId}/finalize`, {}, { identifier: 'snapshot.finalze', ...meta });
  }

  // Convenience method for creating a snapshot for the active build, uploading
  // missing resources for the snapshot, and finalizing the snapshot.
  async sendSnapshot(buildId, options) {
    let { meta = {} } = options;
    let snapshot = await this.createSnapshot(buildId, options);
    meta.snapshotId = snapshot.data.id;

    let missing = snapshot.data.relationships?.['missing-resources']?.data;
    this.log.debug(`${missing?.length || 0} Missing resources: ${options.name}...`, meta);
    if (missing?.length) {
      let resources = options.resources.reduce((acc, r) => Object.assign(acc, { [r.sha]: r }), {});
      await this.uploadResources(buildId, missing.map(({ id }) => resources[id]), meta);
    }
    this.log.debug(`Resources uploaded: ${options.name}...`, meta);

    await this.finalizeSnapshot(snapshot.data.id, meta);

    this.log.debug(`Finalized snapshot: ${options.name}...`, meta);
    return snapshot;
  }

  async createComparison(snapshotId, {
    tag, tiles = [], externalDebugUrl, ignoredElementsData,
    domInfoSha, consideredElementsData, metadata, sync, regions, algorithm,
    algorithmConfiguration, meta = {}
  } = {}) {
    validateId('snapshot', snapshotId);
    // Remove post percy api deploy
    this.log.debug(`Creating comparision: ${tag.name}...`, meta);

    for (let tile of tiles) {
      if (tile.sha) continue;
      if (tile.content && typeof tile.content === 'string') {
        // base64 encoded content coming from SDK
        tile.content = Buffer.from(tile.content, 'base64');
      } else if (tile.filepath) {
        tile.content = await fs.promises.readFile(tile.filepath);
      }
    }
    let regionsArr = makeRegions(regions, algorithm, algorithmConfiguration);
    this.log.debug(`${tiles.length} tiles for comparision: ${tag.name}...`, meta);

    return this.post(`snapshots/${snapshotId}/comparisons`, {
      data: {
        type: 'comparisons',
        attributes: {
          'external-debug-url': externalDebugUrl || null,
          'ignore-elements-data': ignoredElementsData || null,
          regions: regionsArr || null,
          'consider-elements-data': consideredElementsData || null,
          'dom-info-sha': domInfoSha || null,
          sync: !!sync,
          metadata: metadata || null
        },
        relationships: {
          tag: {
            data: {
              type: 'tag',
              attributes: {
                name: tag.name || null,
                width: tag.width || null,
                height: tag.height || null,
                'os-name': tag.osName || null,
                'os-version': tag.osVersion || null,
                orientation: tag.orientation || null,
                'browser-name': tag.browserName || null,
                'browser-version': tag.browserVersion || null,
                resolution: tag.resolution || null
              }
            }
          },
          tiles: {
            data: tiles.map(t => ({
              type: 'tiles',
              attributes: {
                sha: t.sha || (t.content && sha256hash(t.content)),
                'status-bar-height': t.statusBarHeight || null,
                'nav-bar-height': t.navBarHeight || null,
                'header-height': t.headerHeight || null,
                'footer-height': t.footerHeight || null,
                fullscreen: t.fullscreen || null
              }
            }))
          }
        }
      }
    }, { identifier: 'comparison.post', ...meta });
  }

  async uploadComparisonTile(comparisonId, { index = 0, total = 1, filepath, content, sha } = {}, meta = {}) {
    validateId('comparison', comparisonId);
    if (sha) {
      return await this.verify(comparisonId, sha);
    }
    if (filepath && !content) content = await fs.promises.readFile(filepath);
    let encodedContent = base64encode(content);

    this.log.debug(`Uploading ${formatBytes(encodedContent.length)} comparison tile: ${index + 1}/${total} (${comparisonId})...`, meta);
    this.mayBeLogUploadSize(encodedContent.length);

    return this.post(`comparisons/${comparisonId}/tiles`, {
      data: {
        type: 'tiles',
        attributes: {
          'base64-content': encodedContent,
          index
        }
      }
    }, { identifier: 'comparison.tile.post', ...meta });
  }

  // Convenience method for verifying if tile is present
  async verify(comparisonId, sha) {
    let retries = 20;
    let success = null;
    do {
      await waitForTimeout(500);
      success = await this.verifyComparisonTile(comparisonId, sha);
      retries -= 1;
    }
    while (retries > 0 && !success);

    if (!success) {
      let errMsg = 'Uploading comparison tile failed';

      // Detecting error and logging fix for the same
      // We are throwing this error as the comparison will be failed
      // even if 1 tile gets failed
      throw new Error(errMsg);
    }
    return true;
  }

  async verifyComparisonTile(comparisonId, sha, meta = {}) {
    validateId('comparison', comparisonId);
    this.log.debug(`Verifying comparison tile with sha: ${sha}`, meta);

    try {
      return await this.post(`comparisons/${comparisonId}/tiles/verify`, {
        data: {
          type: 'tiles',
          attributes: {
            sha: sha
          }
        }
      }, { identifier: 'comparison.tile.verify', ...meta });
    } catch (error) {
      if (error.response.statusCode === 400) {
        return false;
      }
      this.log.error(error);
      throw error;
    }
  }

  async uploadComparisonTiles(comparisonId, tiles) {
    validateId('comparison', comparisonId);
    this.log.debug(`Uploading comparison tiles for ${comparisonId}...`);

    return pool(function*() {
      for (let index = 0; index < tiles.length; index++) {
        yield this.uploadComparisonTile(comparisonId, {
          index, total: tiles.length, ...tiles[index]
        });
      }
    }, this, 2);
  }

  async finalizeComparison(comparisonId, meta = {}) {
    validateId('comparison', comparisonId);
    this.log.debug(`Finalizing comparison ${comparisonId}...`);
    return this.post(`comparisons/${comparisonId}/finalize`, {}, { identifier: 'comparison.finalize', ...meta });
  }

  async sendComparison(buildId, options) {
    let { meta } = options;
    if (!validateTiles(options.tiles)) {
      throw new Error('sha, filepath or content should be present in tiles object');
    }
    let snapshot = await this.createSnapshot(buildId, options);
    let comparison = await this.createComparison(snapshot.data.id, options);
    await this.uploadComparisonTiles(comparison.data.id, options.tiles);
    this.log.debug(`Created comparison: ${comparison.data.id} ${options.tag.name}`, meta);
    await this.finalizeComparison(comparison.data.id);
    this.log.debug(`Finalized comparison: ${comparison.data.id} ${options.tag.name}`, meta);
    return comparison;
  }

  async sendBuildEvents(buildId, body, meta = {}) {
    validateId('build', buildId);
    this.log.debug('Sending Build Events');
    return this.post(`builds/${buildId}/send-events`, {
      data: body
    }, { identifier: 'build.send_events', ...meta });
  }

  async sendBuildLogs(body, meta = {}) {
    this.log.debug('Sending Build Logs', meta);
    return this.post('logs', {
      data: body
    }, { identifier: 'build.send_logs', ...meta });
  }

  async getErrorAnalysis(errors, meta = {}) {
    const errorLogs = formatLogErrors(errors);
    this.log.debug('Sending error logs for analysis', meta);

    return this.post('suggestions/from_logs', {
      data: errorLogs
    }, { identifier: 'error.analysis.get', ...meta });
  }

  // Performs a review action (approve, unapprove, reject) on a specific build.
  // This function handles the common logic for sending review requests.
  async reviewBuild(buildId, action, username, accessKey) {
    validateId('build', buildId);
    this.log.debug(`Sending ${action} action for build ${buildId}...`);

    const requestBody = {
      data: {
        attributes: {
          action: action
        },
        relationships: {
          build: {
            data: {
              type: 'builds',
              id: buildId
            }
          }
        },
        type: 'reviews'
      }
    };

    // For the review action, we use accessKey and username in custom headers
    // and do not require a project token.
    return this.post(
      'reviews',
      requestBody,
      { identifier: `build.${action}` },
      { Authorization: `Basic ${base64encode(`${username}:${accessKey}`)}` },
      false
    );
  }

  async approveBuild(buildId, username, accessKey) {
    return this.reviewBuild(buildId, 'approve', username, accessKey);
  }

  async unapproveBuild(buildId, username, accessKey) {
    return this.reviewBuild(buildId, 'unapprove', username, accessKey);
  }

  async rejectBuild(buildId, username, accessKey) {
    return this.reviewBuild(buildId, 'reject', username, accessKey);
  }

  async deleteBuild(buildId, username, accessKey) {
    validateId('build', buildId);
    this.log.debug(`Sending Delete action for build ${buildId}...`);

    // For the delete action, we use accessKey and username in custom headers
    // and do not require a project token.
    return this.post(
      `builds/${buildId}/delete`,
      {},
      { identifier: 'build.delete' },
      { Authorization: `Basic ${base64encode(`${username}:${accessKey}`)}` },
      false
    );
  }

  mayBeLogUploadSize(contentSize, meta = {}) {
    if (contentSize >= 25 * 1024 * 1024) {
      this.log.error('Uploading resource above 25MB might fail the build...', meta);
    } else if (contentSize >= 20 * 1024 * 1024) {
      this.log.warn('Uploading resource above 20MB might slow the build...', meta);
    }
  }

  // decides project type
  tokenType() {
    let token = this.getToken(false) || '';

    const type = token.split('_')[0];
    switch (type) {
      case 'auto':
        return 'automate';
      case 'web':
        return 'web';
      case 'app':
        return 'app';
      case 'ss':
        return 'generic';
      case 'vmw':
        return 'visual_scanner';
      case 'res':
        return 'responsive_scanner';
      default:
        return 'web';
    }
  }
}

export default PercyClient;
