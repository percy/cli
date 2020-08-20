import PercyEnvironment from '@percy/env';
import { git } from '@percy/env/dist/git';
import pkg from '../package.json';

import {
  sha256hash,
  base64encode,
  pool,
  httpAgentFor,
  request
} from './utils';

// PercyClient is used to communicate with the Percy API to create and finalize
// builds and snapshot. Uses @percy/env to collect environment information used
// during build creation.
export default class PercyClient {
  constructor({
    // read or write token, defaults to PERCY_TOKEN environment variable
    token,
    // initial user agent info
    clientInfo = '',
    environmentInfo = '',
    // versioned percy api url
    apiUrl = 'https://percy.io/api/v1'
  } = {}) {
    Object.assign(this, {
      token,
      apiUrl,
      httpAgent: httpAgentFor(apiUrl),
      clientInfo: [].concat(clientInfo),
      environmentInfo: [].concat(environmentInfo),
      env: new PercyEnvironment(process.env),
      // build info is stored for reference
      build: { id: null, number: null, url: null }
    });
  }

  // Adds additional unique client info.
  addClientInfo(info) {
    if (info && this.clientInfo.indexOf(info) === -1) {
      this.clientInfo.push(info);
    }
  }

  // Adds additional unique environment info.
  addEnvironmentInfo(info) {
    if (info && this.environmentInfo.indexOf(info) === -1) {
      this.environmentInfo.push(info);
    }
  }

  // Stringifies client and environment info.
  userAgent() {
    let client = [`Percy/${/\w+$/.exec(this.apiUrl)}`]
      .concat(`${pkg.name}/${pkg.version}`, this.clientInfo)
      .filter(Boolean).join(' ');
    let environment = this.environmentInfo
      .concat([`node/${process.version}`, this.env.info])
      .filter(Boolean).join('; ');
    return `${client} (${environment})`;
  }

  // Checks for a Percy token and returns it.
  getToken() {
    let token = this.token || this.env.token;
    if (!token) throw new Error('Missing Percy token');
    return token;
  }

  // Returns common headers used for each request with additional
  // headers. Throws an error when the token is missing, which is a required
  // authorization header.
  headers(headers) {
    return Object.assign({
      Authorization: `Token token=${this.getToken()}`,
      'User-Agent': this.userAgent()
    }, headers);
  }

  // Performs a GET request for an API endpoint with appropriate headers.
  get(path) {
    return request(`${this.apiUrl}/${path}`, {
      method: 'GET',
      agent: this.httpAgent,
      headers: this.headers()
    });
  }

  // Performs a POST request to a JSON API endpoint with appropriate headers.
  post(path, body = {}) {
    return request(`${this.apiUrl}/${path}`, {
      method: 'POST',
      agent: this.httpAgent,
      body: JSON.stringify(body),
      headers: this.headers({
        'Content-Type': 'application/vnd.api+json'
      })
    });
  }

  // Sets build reference data or nullifies it when no data is provided.
  setBuildData(data) {
    return Object.assign(this, {
      build: {
        id: data?.id,
        number: data?.attributes?.['build-number'],
        url: data?.attributes?.['web-url']
      }
    });
  }

  // Creates a build with optional build resources. Only one build can be
  // created at a time per instance so snapshots and build finalization can be
  // done more seemlessly without manually tracking build ids
  async createBuild({ resources = [] } = {}) {
    if (this.build.id) {
      throw new Error('This client instance has not finalized the previous build');
    }

    let body = await this.post('builds', {
      data: {
        type: 'builds',
        attributes: {
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
          partial: this.env.partial
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

    this.setBuildData(body?.data);
    return body;
  }

  // Finalizes the active build. When `all` is true, `all-shards=true` is
  // added as a query param so the API finalizes all other build shards.
  async finalizeBuild({ all = false } = {}) {
    if (!this.build.id) {
      throw new Error('This client instance has no active build');
    }

    let qs = all ? 'all-shards=true' : '';
    let body = await this.post(`builds/${this.build.id}/finalize?${qs}`);

    this.setBuildData();
    return body;
  }

  // Retrieves build data by id. Requires a read access token.
  async getBuild(buildId) {
    return this.get(`builds/${buildId}`);
  }

  // Retrieves project builds optionally filtered. Requires a read access token.
  async getBuilds(projectSlug, filters = {}) {
    let qs = Object.keys(filters).map(k => (
      Array.isArray(filters[k])
        ? filters[k].map(v => `filter[${k}][]=${v}`).join('&')
        : `filter[${k}]=${filters[k]}`
    )).join('&');

    return this.get(`projects/${projectSlug}/builds?${qs}`);
  }

  // Resolves when the build has finished and is no longer pending or
  // processing. By default, will time out if no update after 10 minutes.
  waitForBuild({
    build,
    project,
    commit,
    progress,
    timeout = 600000,
    interval = 1000
  }) {
    if (commit && !project) {
      throw new Error('Missing project for commit');
    } else if (!commit && !build) {
      throw new Error('Missing build ID or commit SHA');
    }

    // get build data by id or project-commit combo
    let getBuildData = async () => {
      let sha = commit && (git(`rev-parse ${commit}`) || commit);
      let body = build ? await this.getBuild(build)
        : await this.getBuilds(project, { sha });
      let data = build ? body?.data : body?.data[0];
      return [data, data?.attributes.state];
    };

    // recursively poll every second until the build finishes
    return new Promise((resolve, reject) => (async function poll(last, t) {
      try {
        let [data, state] = await getBuildData();
        let updated = JSON.stringify(data) !== JSON.stringify(last);
        let pending = !state || state === 'pending' || state === 'processing';

        // new data recieved
        if (updated) {
          t = Date.now();

        // no new data within the timeout
        } else if (Date.now() - t >= timeout) {
          throw new Error('Timeout exceeded without an update');
        }

        // call progress after the first update
        if ((last || pending) && updated && progress) {
          progress(data);
        }

        // not finished, poll again
        if (pending) {
          return setTimeout(poll, interval, data, t);

        // build finished
        } else {
          resolve(data);
        }
      } catch (err) {
        reject(err);
      }
    })(null, Date.now()));
  }

  // Uploads a single resource to the active build. If `filepath` is provided,
  // `content` is read from the filesystem. The sha is optional and will be
  // created from `content` if one is not provided.
  async uploadResource({ sha, filepath, content }) {
    if (!this.build.id) {
      throw new Error('This client instance has no active build');
    }

    content = filepath
      ? require('fs').readFileSync(filepath)
      : content;

    return this.post(`builds/${this.build.id}/resources`, {
      data: {
        type: 'resources',
        id: sha || sha256hash(content),
        attributes: {
          'base64-content': base64encode(content)
        }
      }
    });
  }

  // Uploads resources to the active build concurrently, two at a time.
  async uploadResources(resources) {
    if (!this.build.id) {
      throw new Error('This client instance has no active build');
    }

    return pool(function*() {
      for (let resource of resources) {
        yield this.uploadResource(resource);
      }
    }, this, 2);
  }

  // Creates a snapshot for the active build using the provided attributes.
  async createSnapshot({
    name,
    widths,
    minHeight,
    enableJavaScript,
    clientInfo,
    environmentInfo,
    resources = []
  } = {}) {
    if (!this.build.id) {
      throw new Error('This client instance has no active build');
    }

    this.addClientInfo(clientInfo);
    this.addEnvironmentInfo(environmentInfo);

    return this.post(`builds/${this.build.id}/snapshots`, {
      data: {
        type: 'snapshots',
        attributes: {
          name: name || null,
          widths: widths || null,
          'minimum-height': minHeight || null,
          'enable-javascript': enableJavaScript || null
        },
        relationships: {
          resources: {
            data: resources.map(r => ({
              type: 'resources',
              id: r.sha || sha256hash(r.content),
              attributes: {
                'resource-url': r.url || null,
                'is-root': r.root || null,
                mimetype: r.mimetype || null
              }
            }))
          }
        }
      }
    });
  }

  // Finalizes a snapshot.
  async finalizeSnapshot(snapshotId) {
    return this.post(`snapshots/${snapshotId}/finalize`);
  }

  // Convenience method for creating a snapshot for the active build, uploading
  // missing resources for the snapshot, and finalizing the snapshot.
  async sendSnapshot(options) {
    let { data } = await this.createSnapshot(options);
    let missing = data.relationships?.['missing-resources']?.data;

    if (missing?.length) {
      let resources = options.resources
        .reduce((acc, r) => Object.assign(acc, { [r.sha]: r }), {});
      await this.uploadResources(missing.map(({ id }) => resources[id]));
    }

    await this.finalizeSnapshot(data.id);
  }
}
