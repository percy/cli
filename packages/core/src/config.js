import { strict as assert } from 'assert';
import { merge } from '@percy/config/dist/utils';
import { hostname } from './utils';

// Common options used in Percy commands
export const schema = {
  snapshot: {
    type: 'object',
    additionalProperties: false,
    properties: {
      widths: {
        type: 'array',
        items: { type: 'integer' },
        default: [375, 1280]
      },
      minHeight: {
        type: 'integer',
        default: 1024
      },
      percyCSS: {
        type: 'string',
        default: ''
      },
      enableJavaScript: {
        type: 'boolean'
      }
    }
  },
  discovery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowedHostnames: {
        type: 'array',
        items: { type: 'string' },
        default: []
      },
      networkIdleTimeout: {
        type: 'integer',
        default: 100
      },
      disableCache: {
        type: 'boolean'
      },
      requestHeaders: {
        type: 'object',
        additionalProperties: { type: 'string' }
      },
      authorization: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      cookies: {
        anyOf: [{
          type: 'object',
          additionalProperties: { type: 'string' }
        }, {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string' },
              value: { type: 'string' }
            }
          }
        }]
      },
      userAgent: {
        type: 'string'
      },
      concurrency: {
        type: 'integer'
      },
      launchOptions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          executable: { type: 'string' },
          timeout: { type: 'integer' },
          args: { type: 'array', items: { type: 'string' } },
          headless: { type: 'boolean' }
        }
      }
    }
  }
};

// Migration function
export function migration(config, { map, del, log }) {
  /* eslint-disable curly */
  if (config.version < 2) {
    // discovery options have moved
    map('agent.assetDiscovery.allowedHostnames', 'discovery.allowedHostnames');
    map('agent.assetDiscovery.networkIdleTimeout', 'discovery.networkIdleTimeout');
    map('agent.assetDiscovery.cacheResponses', 'discovery.disableCache', v => !v);
    map('agent.assetDiscovery.requestHeaders', 'discovery.requestHeaders');
    map('agent.assetDiscovery.pagePoolSizeMax', 'discovery.concurrency');
    del('agent');
  } else {
    // snapshot discovery options have moved
    for (let k of ['authorization', 'requestHeaders']) {
      if (config.snapshot?.[k]) {
        log.deprecated(
          `The config option \`snapshot.${k}\` will be removed in 1.0.0. ` +
          `Use \`discovery.${k}\` instead.`);
        map(`snapshot.${k}`, `discovery.${k}`);
      }
    }
  }
}

// Validate and merge per-snapshot configuration options with global configuration options.
export function getSnapshotConfig({
  url,
  name,
  // per-snapshot options
  widths,
  minHeight,
  percyCSS,
  enableJavaScript,
  discovery,
  // use a specific dom snapshot
  domSnapshot,
  // capture a fresh dom snapshot
  execute,
  waitForTimeout,
  waitForSelector,
  additionalSnapshots,
  // sdk options
  clientInfo,
  environmentInfo,
  // deprecated options
  ...deprecated
}, config, log) {
  // required per-snapshot
  assert(url, 'Missing required URL for snapshot');

  // override and sort widths
  widths = [...(widths?.length ? widths : config.snapshot.widths)].sort((a, b) => a - b);
  assert(widths?.length, 'Missing required widths for snapshot');
  assert(widths.length <= 10, `Too many widths requested: maximum is 10, requested ${widths}`);

  // dom snapshot and capture options are exclusive
  if (domSnapshot != null) {
    let conflict = Object
      .entries({ execute, waitForTimeout, waitForSelector, additionalSnapshots })
      .find(option => option[1] != null)?.[0];
    assert(!conflict, `Conflicting options: domSnapshot, ${conflict}`);
  }

  // discovery options have moved
  for (let k of ['authorization', 'requestHeaders']) {
    if (deprecated[k]) {
      log.warn(`Warning: The snapshot option \`${k}\` ` +
        `will be removed in 1.0.0. Use \`discovery.${k}\` instead.`);
      (discovery ??= {})[k] ??= deprecated[k];
    }
  }

  // snapshots option was renamed
  if (deprecated.snapshots) {
    log.warn('Warning: The `snapshots` option will be ' +
      'removed in 1.0.0. Use `additionalSnapshots` instead.');
    additionalSnapshots ??= deprecated.snapshots;
  }

  // default name to the URL /pathname?search#hash
  if (!name) {
    let uri = new URL(url);
    name = `${uri.pathname}${uri.search}${uri.hash}`;
  }

  // additional snapshots must be named but allow inheritance with a prefix/suffix
  additionalSnapshots = (additionalSnapshots || [])
    .map(({ name: n, prefix = '', suffix = '', ...opts }) => {
      assert(n || prefix || suffix, 'Missing additional snapshot name, prefix, or suffix');
      return { name: n || `${prefix}${name}${suffix}`, ...opts };
    });

  // concatenate percy css
  percyCSS = [config.snapshot.percyCSS, percyCSS].filter(Boolean).join('\n');

  // default options
  minHeight ??= config.snapshot.minHeight;
  enableJavaScript ??= config.snapshot.enableJavaScript;

  // merge common discovery options
  discovery = merge([{
    // always allow the root hostname
    allowedHostnames: [hostname(url), ...config.discovery.allowedHostnames],
    requestHeaders: config.discovery.requestHeaders,
    authorization: config.discovery.authorization,
    disableCache: config.discovery.disableCache,
    userAgent: config.discovery.userAgent
  }, discovery]);

  return {
    url,
    name,
    widths,
    minHeight,
    percyCSS,
    enableJavaScript,
    discovery,
    domSnapshot,
    execute,
    waitForTimeout,
    waitForSelector,
    additionalSnapshots,
    clientInfo,
    environmentInfo
  };
}
