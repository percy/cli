import { expectType, expectError } from 'tsd';
import Percy, { Region, PercyOptions, PercyConfigOptions, CreateRegionOptions, createRegion } from '@percy/core';

// PercyOptions
const percyOptions: PercyOptions = {
  token: 'PERCY_TOKEN',
  clientInfo: 'sdk-client-info',
  environmentInfo: 'sdk-environment-info',
  server: false,
  port: 5338,
  concurrency: 1,
  loglevel: 'info',
  config: '.percy.yml',
  snapshot: {
    widths: [1280],
    minHeight: 1024,
    percyCSS: '.percy { color: purple; }',
    enableJavaScript: false,
    scope: '.percy',
    scopeOptions: { scroll: true },
    devicePixelRatio: 2
  },
  discovery: {
    requestHeaders: { Authorization: 'foobar' },
    allowedHostnames: ['*.percy.io'],
    networkIdleTimeout: 100,
    disableCache: false,
    concurrency: 1,
    launchOptions: {
      args: ['--foo-bar']
    }
  },
  foo: {
    bar: 'baz'
  }
};

// new Percy()
const percy = new Percy();
expectType<Percy>(percy);
expectType<Percy>(new Percy(percyOptions));

// Percy.start()
expectType<Promise<Percy>>(Percy.start());
expectType<Promise<Percy>>(Percy.start(percyOptions));

// #loglevel()
expectType<'error' | 'warn' | 'info' | 'debug' | 'silent'>(percy.loglevel());
expectType<void>(percy.loglevel('error'));

// #config
expectType<PercyConfigOptions>(percy.config);
// #setConfig()
expectType<PercyConfigOptions>(percy.setConfig({
  clientInfo: 'client/info',
  environmentInfo: 'env/info',
  snapshot: { widths: [1000] }
}));

expectError(percy.setConfig({
  snapshot: { foo: 'bar' }
}));

// #start()
expectType<Promise<void>>(percy.start());

// #stop()
expectType<Promise<void>>(percy.stop());
expectType<Promise<void>>(percy.stop(true));

// #idle()
expectType<Promise<void>>(percy.idle());

// #close()
expectType<void>(percy.close());

// #snapshot()
expectType<Promise<void>>(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...',
  widths: [1000],
  minHeight: 1000,
  percyCSS: '.foo { font-weight: 900; }',
  enableJavaScript: true,
  discovery: {
    authorization: { username: 'u', password: '*' },
    requestHeaders: { 'x-testing': 'test' },
    allowedHostnames: ['foobar'],
    disableCache: true,
    autoConfigureAllowedHostnames: true
  }
}));

expectType<Promise<void>>(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...'
}));

expectType<Promise<void>>(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  waitForTimeout: 1000,
  waitForSelector: '.some-selector',
  execute() {},
  additionalSnapshots: [{
    name: 'test 2',
    async execute() {}
  }]
}));

expectType<Promise<void>>(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000'
}));

expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    suffix: '- additional',
    execute() {}
  }]
}));

expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    prefix: 'additional - ',
    execute() {}
  }]
}));

expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    prefix: '- ',
    suffix: ' -',
    execute() {}
  }]
}));

expectError(percy.snapshot());

expectError(percy.snapshot({
  name: 'test snapshot'
}));

expectError(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  foo: true
}));

expectError(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    execute() {}
  }]
}));

expectError(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    name: 'test snapshot'
  }]
}));

expectError(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    name: 'test snapshot',
    prefix: '- ',
    execute() {}
  }]
}));

expectError(percy.snapshot({
  url: 'http://localhost:3000',
  additionalSnapshots: [{
    name: 'test snapshot',
    suffix: ' -',
    execute() {}
  }]
}));

expectError(percy.snapshot({
  url: 'http://localhost:3000',
  domSnapshot: '...',
  waitForTimeout: 200
}));

// Region type
const region: Region = {
  algorithm: 'default',
  elementSelector: {
    elementCSS: '.header'
  }
};
expectType<Region>(region);

const regionWithPadding: Region = {
  algorithm: 'default',
  elementSelector: {
    elementCSS: '.card'
  },
  padding: {
    top: 5,
    left: 10,
    right: 10,
    bottom: 5
  }
};
expectType<Region>(regionWithPadding);

const regionWithConfiguration: Region = {
  algorithm: 'default',
  elementSelector: {
    elementCSS: '.banner'
  },
  configuration: {
    diffSensitivity: 0.1,
    imageIgnoreThreshold: 0.05,
    carouselsEnabled: true,
    bannersEnabled: true,
    adsEnabled: false
  }
};
expectType<Region>(regionWithConfiguration);

const regionWithAssertion: Region = {
  algorithm: 'default',
  elementSelector: {
    elementCSS: '.content'
  },
  assertion: {
    diffIgnoreThreshold: 0.02
  }
};
expectType<Region>(regionWithAssertion);

const regionFull: Region = {
  algorithm: 'advanced',
  elementSelector: {
    boundingBox: {
      x: 5,
      y: 5,
      width: 300,
      height: 200
    },
    elementCSS: '.interactive',
    elementXpath: '//section[@class="interactive"]'
  },
  padding: {
    top: 15,
    left: 20,
    right: 20,
    bottom: 15
  },
  configuration: {
    diffSensitivity: 0.15,
    imageIgnoreThreshold: 0.1,
    carouselsEnabled: true,
    bannersEnabled: true,
    adsEnabled: true
  },
  assertion: {
    diffIgnoreThreshold: 0.05
  }
};
expectType<Region>(regionFull);

// CreateRegionOptions type
const createRegionOptions: CreateRegionOptions = {
  boundingBox: {
    x: 10,
    y: 10,
    width: 200,
    height: 100
  },
  algorithm: 'default',
  diffSensitivity: 0.1
};
expectType<CreateRegionOptions>(createRegionOptions);

const createRegionWithXpath: CreateRegionOptions = {
  elementXpath: '//nav',
  padding: {
    top: 10
  },
  carouselsEnabled: true
};
expectType<CreateRegionOptions>(createRegionWithXpath);

const createRegionWithCSS: CreateRegionOptions = {
  elementCSS: '.footer',
  bannersEnabled: false,
  adsEnabled: true
};
expectType<CreateRegionOptions>(createRegionWithCSS);

// createRegion function
expectType<Region>(createRegion({
  elementCSS: '.header',
  algorithm: 'default'
}));

expectType<Region>(createRegion({
  boundingBox: {
    x: 0,
    y: 0,
    width: 100,
    height: 50
  },
  padding: {
    top: 5,
    bottom: 5
  },
  diffSensitivity: 0.1
}));

// Snapshot with regions
expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  name: 'Snapshot with regions',
  regions: [
    {
      algorithm: 'default',
      elementSelector: {
        elementCSS: '.header'
      }
    }
  ]
}));

expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  regions: [
    {
      algorithm: 'default',
      elementSelector: {
        elementCSS: '.header'
      },
      padding: {
        top: 10,
        bottom: 10
      }
    },
    {
      algorithm: 'default',
      elementSelector: {
        elementXpath: '//footer'
      },
      configuration: {
        carouselsEnabled: true
      }
    }
  ]
}));

expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  regions: []
}));

expectType<Promise<void>>(percy.snapshot({
  url: 'http://localhost:3000',
  name: 'Snapshot',
  regions: [region, regionWithPadding, regionFull]
}));
