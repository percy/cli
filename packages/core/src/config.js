// Common config options used in Percy commands
export const configSchema = {
  percy: {
    type: 'object',
    additionalProperties: false,
    properties: {
      deferUploads: {
        type: 'boolean'
      },
      useSystemProxy: {
        type: 'boolean',
        default: false
      },
      token: {
        type: 'string'
      },
      labels: {
        type: 'string'
      },
      skipBaseBuild: {
        type: 'boolean',
        default: false
      }
    }
  },
  snapshot: {
    type: 'object',
    additionalProperties: false,
    definitions: {
      configurationProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          diffSensitivity: { type: 'integer', minimum: 0, maximum: 4 },
          imageIgnoreThreshold: { type: 'number', minimum: 0, maximum: 1 },
          carouselsEnabled: { type: 'boolean' },
          bannersEnabled: { type: 'boolean' },
          adsEnabled: { type: 'boolean' }
        }
      }
    },
    properties: {
      widths: {
        type: 'array',
        default: [375, 1280],
        items: {
          type: 'integer',
          maximum: 2000,
          minimum: 120
        }
      },
      minHeight: {
        type: 'integer',
        default: 1024,
        maximum: 2000,
        minimum: 10
      },
      percyCSS: {
        type: 'string',
        default: ''
      },
      enableJavaScript: {
        type: 'boolean',
        default: false
      },
      cliEnableJavaScript: {
        type: 'boolean',
        default: true
      },
      disableShadowDOM: {
        type: 'boolean',
        default: false
      },
      enableLayout: {
        type: 'boolean'
      },
      domTransformation: {
        type: 'string'
      },
      reshuffleInvalidTags: {
        type: 'boolean'
      },
      scope: {
        type: 'string'
      },
      scopeOptions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scroll: {
            type: 'boolean'
          }
        }
      },
      sync: {
        type: 'boolean'
      },
      responsiveSnapshotCapture: {
        type: 'boolean',
        default: false
      },
      testCase: {
        type: 'string'
      },
      labels: {
        type: 'string'
      },
      thTestCaseExecutionId: {
        type: 'string'
      },
      browsers: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1
        },
        onlyWeb: true
      },
      fullPage: {
        type: 'boolean',
        onlyAutomate: true
      },
      freezeAnimation: { // for backward compatibility
        type: 'boolean',
        onlyAutomate: true
      },
      freezeAnimatedImage: {
        type: 'boolean',
        onlyAutomate: true
      },
      freezeAnimatedImageOptions: {
        type: 'object',
        additionalProperties: false,
        onlyAutomate: true,
        properties: {
          freezeImageBySelectors: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          freezeImageByXpaths: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      },
      ignoreRegions: {
        type: 'object',
        additionalProperties: false,
        onlyAutomate: true,
        properties: {
          ignoreRegionSelectors: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          ignoreRegionXpaths: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      },
      considerRegions: {
        type: 'object',
        additionalProperties: false,
        onlyAutomate: true,
        properties: {
          considerRegionSelectors: {
            type: 'array',
            items: {
              type: 'string'
            }
          },
          considerRegionXpaths: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      },
      regions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            elementSelector: {
              type: 'object',
              additionalProperties: false,
              properties: {
                boundingBox: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    x: { type: 'integer' },
                    y: { type: 'integer' },
                    width: { type: 'integer' },
                    height: { type: 'integer' }
                  }
                },
                elementXpath: { type: 'string' },
                elementCSS: { type: 'string' }
              }
            },
            padding: {
              type: 'object',
              additionalProperties: false,
              properties: {
                top: { type: 'integer' },
                bottom: { type: 'integer' },
                left: { type: 'integer' },
                right: { type: 'integer' }
              }
            },
            algorithm: {
              type: 'string',
              enum: ['standard', 'layout', 'ignore', 'intelliignore']
            },
            configuration: { $ref: '#/definitions/configurationProperties' },
            assertion: {
              type: 'object',
              additionalProperties: false,
              properties: {
                diffIgnoreThreshold: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          },
          required: ['algorithm']
        }
      },
      algorithm: {
        type: 'string',
        enum: ['standard', 'layout', 'intelliignore']
      },
      algorithmConfiguration: { $ref: '#/definitions/configurationProperties' },
      ignoreCanvasSerializationErrors: {
        type: 'boolean',
        default: false
      }
    }
  },
  discovery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowedHostnames: {
        type: 'array',
        default: [],
        items: {
          type: 'string',
          allOf: [{
            not: { pattern: '[^/]/' },
            error: 'must not include a pathname'
          }, {
            not: { pattern: '^([a-zA-Z]+:)?//' },
            error: 'must not include a protocol'
          }]
        }
      },
      disallowedHostnames: {
        type: 'array',
        default: [],
        items: {
          type: 'string',
          allOf: [{
            not: { pattern: '[^/]/' },
            error: 'must not include a pathname'
          }, {
            not: { pattern: '^([a-zA-Z]+:)?//' },
            error: 'must not include a protocol'
          }]
        }
      },
      networkIdleTimeout: {
        type: 'integer',
        default: 100,
        maximum: 750,
        minimum: 1
      },
      waitForSelector: {
        type: 'string'
      },
      waitForTimeout: {
        type: 'integer',
        minimum: 1,
        maximum: 30000
      },
      scrollToBottom: {
        type: 'boolean',
        default: false
      },
      disableCache: {
        type: 'boolean'
      },
      captureMockedServiceWorker: {
        type: 'boolean',
        default: false
      },
      captureSrcset: {
        type: 'boolean'
      },
      requestHeaders: {
        type: 'object',
        normalize: false,
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
          normalize: false,
          additionalProperties: { type: 'string' }
        }, {
          type: 'array',
          normalize: false,
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
      devicePixelRatio: {
        type: 'integer'
      },
      concurrency: {
        type: 'integer',
        minimum: 1
      },
      snapshotConcurrency: {
        type: 'integer',
        minimum: 1
      },
      retry: {
        type: 'boolean',
        default: false
      },
      launchOptions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          executable: { type: 'string' },
          timeout: { type: 'integer' },
          args: { type: 'array', items: { type: 'string' } },
          headless: { type: 'boolean' },
          closeBrowser: { type: 'boolean', default: true }
        }
      }
    }
  }
};

// Common per-snapshot capture options
export const snapshotSchema = {
  $id: '/snapshot',
  $ref: '#/$defs/snapshot',
  $defs: {
    common: {
      type: 'object',
      properties: {
        widths: { $ref: '/config/snapshot#/properties/widths' },
        scope: { $ref: '/config/snapshot#/properties/scope' },
        minHeight: { $ref: '/config/snapshot#/properties/minHeight' },
        percyCSS: { $ref: '/config/snapshot#/properties/percyCSS' },
        enableJavaScript: { $ref: '/config/snapshot#/properties/enableJavaScript' },
        cliEnableJavaScript: { $ref: '/config/snapshot#/properties/cliEnableJavaScript' },
        disableShadowDOM: { $ref: '/config/snapshot#/properties/disableShadowDOM' },
        domTransformation: { $ref: '/config/snapshot#/properties/domTransformation' },
        enableLayout: { $ref: '/config/snapshot#/properties/enableLayout' },
        sync: { $ref: '/config/snapshot#/properties/sync' },
        responsiveSnapshotCapture: { $ref: '/config/snapshot#/properties/responsiveSnapshotCapture' },
        testCase: { $ref: '/config/snapshot#/properties/testCase' },
        labels: { $ref: '/config/snapshot#/properties/labels' },
        thTestCaseExecutionId: { $ref: '/config/snapshot#/properties/thTestCaseExecutionId' },
        browsers: { $ref: '/config/snapshot#/properties/browsers' },
        reshuffleInvalidTags: { $ref: '/config/snapshot#/properties/reshuffleInvalidTags' },
        regions: { $ref: '/config/snapshot#/properties/regions' },
        algorithm: { $ref: '/config/snapshot#/properties/algorithm' },
        algorithmConfiguration: { $ref: '/config/snapshot#/properties/algorithmConfiguration' },
        scopeOptions: { $ref: '/config/snapshot#/properties/scopeOptions' },
        ignoreCanvasSerializationErrors: { $ref: '/config/snapshot#/properties/ignoreCanvasSerializationErrors' },
        discovery: {
          type: 'object',
          additionalProperties: false,
          properties: {
            allowedHostnames: { $ref: '/config/discovery#/properties/allowedHostnames' },
            disallowedHostnames: { $ref: '/config/discovery#/properties/disallowedHostnames' },
            requestHeaders: { $ref: '/config/discovery#/properties/requestHeaders' },
            waitForSelector: { $ref: '/config/discovery#/properties/waitForSelector' },
            waitForTimeout: { $ref: '/config/discovery#/properties/waitForTimeout' },
            authorization: { $ref: '/config/discovery#/properties/authorization' },
            disableCache: { $ref: '/config/discovery#/properties/disableCache' },
            captureMockedServiceWorker: { $ref: '/config/discovery#/properties/captureMockedServiceWorker' },
            captureSrcset: { $ref: '/config/discovery#/properties/captureSrcset' },
            userAgent: { $ref: '/config/discovery#/properties/userAgent' },
            devicePixelRatio: { $ref: '/config/discovery#/properties/devicePixelRatio' },
            retry: { $ref: '/config/discovery#/properties/retry' },
            scrollToBottom: { $ref: '/config/discovery#/properties/scrollToBottom' }
          }
        }
      },
      dependencies: {
        scopeOptions: ['scope']
      }
    },
    exec: {
      error: 'must be a function, function body, or array of functions',
      oneOf: [
        { oneOf: [{ type: 'string' }, { instanceof: 'Function' }] },
        { type: 'array', items: { $ref: '/snapshot#/$defs/exec/oneOf/0' } }
      ]
    },
    precapture: {
      type: 'object',
      properties: {
        waitForSelector: { type: 'string' },
        waitForTimeout: { type: 'integer', minimum: 1, maximum: 30000 }
      }
    },
    capture: {
      type: 'object',
      allOf: [
        { $ref: '/snapshot#/$defs/common' },
        { $ref: '/snapshot#/$defs/precapture' }
      ],
      properties: {
        name: { type: 'string' },
        execute: {
          oneOf: [{ $ref: '/snapshot#/$defs/exec' }, {
            type: 'object',
            additionalProperties: false,
            properties: {
              afterNavigation: { $ref: '/snapshot#/$defs/exec' },
              beforeResize: { $ref: '/snapshot#/$defs/exec' },
              afterResize: { $ref: '/snapshot#/$defs/exec' },
              beforeSnapshot: { $ref: '/snapshot#/$defs/exec' }
            }
          }]
        },
        additionalSnapshots: {
          type: 'array',
          items: {
            type: 'object',
            $ref: '/snapshot#/$defs/precapture',
            unevaluatedProperties: false,
            oneOf: [{
              required: ['name']
            }, {
              anyOf: [
                { required: ['prefix'] },
                { required: ['suffix'] }
              ]
            }],
            properties: {
              name: { type: 'string' },
              prefix: { type: 'string' },
              suffix: { type: 'string' },
              execute: { $ref: '/snapshot#/$defs/exec' }
            },
            errors: {
              oneOf: ({ params }) => params.passingSchemas
                ? 'prefix & suffix are ignored when a name is provided'
                : 'missing required name, prefix, or suffix'
            }
          }
        }
      }
    },
    predicate: {
      error: 'must be a pattern or an array of patterns',
      oneOf: [{
        oneOf: [
          { type: 'string' },
          { instanceof: 'RegExp' },
          { instanceof: 'Function' }
        ]
      }, {
        type: 'array',
        items: { $ref: '/snapshot#/$defs/predicate/oneOf/0' }
      }]
    },
    filter: {
      type: 'object',
      properties: {
        include: { $ref: '/snapshot#/$defs/predicate' },
        exclude: { $ref: '/snapshot#/$defs/predicate' }
      }
    },
    options: {
      oneOf: [{
        type: 'object',
        unevaluatedProperties: false,
        allOf: [
          { $ref: '/snapshot#/$defs/filter' },
          { $ref: '/snapshot#/$defs/capture' }
        ]
      }, {
        type: 'array',
        items: { $ref: '/snapshot#/$defs/options/oneOf/0' }
      }]
    },
    snapshot: {
      type: 'object',
      required: ['url'],
      $ref: '/snapshot#/$defs/capture',
      unevaluatedProperties: false,
      properties: {
        url: { type: 'string' }
      }
    },
    snapshots: {
      type: 'array',
      items: {
        oneOf: [
          { $ref: '/snapshot#/$defs/snapshot' },
          { $ref: '/snapshot#/$defs/snapshot/properties/url' }
        ]
      }
    },
    dom: {
      type: 'object',
      $id: '/snapshot/dom',
      $ref: '/snapshot#/$defs/common',
      required: ['url', 'domSnapshot'],
      unevaluatedProperties: false,
      properties: {
        url: { type: 'string' },
        name: { type: 'string' },
        width: { $ref: '/config/snapshot#/properties/widths/items' },
        domSnapshot: {
          oneOf: [{ type: 'string' }, {
            type: 'object',
            required: ['html'],
            unevaluatedProperties: false,
            properties: {
              html: { type: 'string' },
              warnings: {
                type: 'array',
                items: { type: 'string' }
              },
              cookies: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              userAgent: { type: 'string' },
              width: { $ref: '/config/snapshot#/properties/widths/items' },
              resources: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['url', 'content', 'mimetype'],
                  unevaluatedProperties: false,
                  properties: {
                    url: { type: 'string' },
                    content: { type: 'string' },
                    mimetype: { type: 'string' }
                  }
                }
              },
              hints: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          },
          { type: 'array', items: { $ref: '/snapshot#/$defs/dom/properties/domSnapshot/oneOf/1' } }
          ]
        }
      },
      errors: {
        unevaluatedProperties: e => (
          snapshotSchema.$defs.precapture.properties[e.params.unevaluatedProperty] ||
          snapshotSchema.$defs.capture.properties[e.params.unevaluatedProperty]
        ) ? 'not accepted with DOM snapshots' : 'unknown property'
      }
    },
    list: {
      type: 'object',
      $id: '/snapshot/list',
      $ref: '/snapshot#/$defs/filter',
      unevaluatedProperties: false,
      required: ['snapshots'],
      properties: {
        baseUrl: {
          type: 'string',
          pattern: '^https?://',
          errors: { pattern: 'must include a protocol and hostname' }
        },
        snapshots: { $ref: '/snapshot#/$defs/snapshots' },
        options: { $ref: '/snapshot#/$defs/options' }
      }
    },
    server: {
      type: 'object',
      $id: '/snapshot/server',
      $ref: '/snapshot#/$defs/filter',
      unevaluatedProperties: false,
      required: ['serve'],
      properties: {
        serve: { type: 'string' },
        port: { type: 'integer' },
        baseUrl: {
          type: 'string',
          pattern: '^/',
          errors: { pattern: 'must start with a forward slash (/)' }
        },
        cleanUrls: {
          type: 'boolean'
        },
        rewrites: {
          type: 'object',
          normalize: false,
          additionalProperties: { type: 'string' }
        },
        snapshots: { $ref: '/snapshot#/$defs/snapshots' },
        options: { $ref: '/snapshot#/$defs/options' }
      }
    },
    sitemap: {
      type: 'object',
      $id: '/snapshot/sitemap',
      $ref: '/snapshot#/$defs/filter',
      required: ['sitemap'],
      unevaluatedProperties: false,
      properties: {
        sitemap: { type: 'string' },
        options: { $ref: '/snapshot#/$defs/options' }
      }
    }
  }
};

const regionsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      selector: {
        type: 'string'
      },
      coOrdinates: {
        type: 'object',
        properties: {
          top: {
            type: 'integer',
            minimum: 0
          },
          left: {
            type: 'integer',
            minimum: 0
          },
          bottom: {
            type: 'integer',
            minimum: 0
          },
          right: {
            type: 'integer',
            minimum: 0
          }
        }
      }
    }
  }
};

// Comparison upload options
export const comparisonSchema = {
  type: 'object',
  $id: '/comparison',
  required: ['name', 'tag'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    externalDebugUrl: { type: 'string' },
    domInfoSha: { type: 'string' },
    sync: { type: 'boolean' },
    testCase: {
      type: 'string'
    },
    thTestCaseExecutionId: {
      type: 'string'
    },
    metadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        windowHeight: {
          type: 'integer',
          minimum: 0
        },
        cliScreenshotStartTime: { type: 'integer', default: 0 },
        cliScreenshotEndTime: { type: 'integer', default: 0 },
        screenshotType: { type: 'string', default: 'singlepage' }
      }
    },
    tag: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string' },
        osName: { type: 'string' },
        osVersion: { type: 'string' },
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 10000
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 10000
        },
        orientation: {
          type: 'string',
          enum: ['portrait', 'landscape']
        },
        browserName: { type: 'string' },
        browserVersion: { type: 'string' },
        resolution: { type: 'string' }
      }
    },
    tiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          filepath: {
            type: 'string'
          },
          content: {
            type: 'string'
          },
          sha: {
            type: 'string'
          },
          statusBarHeight: {
            type: 'integer',
            minimum: 0
          },
          navBarHeight: {
            type: 'integer',
            minimum: 0
          },
          headerHeight: {
            type: 'integer',
            minimum: 0
          },
          footerHeight: {
            type: 'integer',
            minimum: 0
          },
          fullscreen: {
            type: 'boolean'
          }
        }
      }
    },
    ignoredElementsData: {
      type: 'object',
      additionalProperties: false,
      required: ['ignoreElementsData'],
      properties: {
        ignoreElementsData: regionsSchema
      }
    },
    regions: { $ref: '/config/snapshot#/properties/regions' },
    algorithm: { $ref: '/config/snapshot#/properties/algorithm' },
    algorithmConfiguration: { $ref: '/config/snapshot#/properties/algorithmConfiguration' },
    consideredElementsData: {
      type: 'object',
      additionalProperties: false,
      required: ['considerElementsData'],
      properties: {
        considerElementsData: regionsSchema
      }
    }
  }
};

// Grouped schemas for easier registration
export const schemas = [
  configSchema,
  snapshotSchema,
  comparisonSchema
];

// Config migrate function
export function configMigration(config, util) {
  /* eslint-disable curly */
  if (config.version < 2) {
    // discovery options have moved
    util.map('agent.assetDiscovery.allowedHostnames', 'discovery.allowedHostnames');
    util.map('agent.assetDiscovery.networkIdleTimeout', 'discovery.networkIdleTimeout');
    util.map('agent.assetDiscovery.cacheResponses', 'discovery.disableCache', v => !v);
    util.map('agent.assetDiscovery.requestHeaders', 'discovery.requestHeaders');
    util.map('agent.assetDiscovery.pagePoolSizeMax', 'discovery.concurrency');
    util.del('agent');
  } else {
    util.deprecate('snapshot.devicePixelRatio', {
      map: 'discovery.devicePixelRatio',
      type: 'config',
      until: '2.0.0'
    });
  }
}

// Snapshot option migrate function
export function snapshotMigration(config, util, root = '') {
  // discovery options have moved
  util.deprecate(`${root}.devicePixelRatio`, {
    map: `${root}.discovery.devicePixelRatio`,
    type: 'snapshot',
    until: '2.0.0',
    warn: true
  });
}

// Snapshot list options migrate function
export function snapshotListMigration(config, util) {
  if (config.snapshots) {
    // migrate each snapshot options
    for (let i in config.snapshots) {
      if (typeof config.snapshots[i] !== 'string') {
        snapshotMigration(config, util, `snapshots[${i}]`);
      }
    }
  }

  // migrate options
  if (Array.isArray(config.options)) {
    for (let i in config.options) {
      snapshotMigration(config, util, `options[${i}]`);
    }
  } else {
    snapshotMigration(config, util, 'options');
  }
}

// Grouped migrations for easier registration
export const migrations = {
  '/config': configMigration,
  '/snapshot': snapshotMigration,
  '/snapshot/dom': snapshotMigration,
  '/snapshot/list': snapshotListMigration,
  '/snapshot/server': snapshotListMigration,
  '/snapshot/sitemap': snapshotListMigration
};
