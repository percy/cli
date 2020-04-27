import { expectType, expectError } from 'tsd';
import Percy, { PercyOptions } from '@percy/core';

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
    minimumHeight: 1024,
    percyCSS: '.percy { color: purple; }',
    requestHeaders: { Authorization: 'foobar' },
    enableJavaScript: false
  },
  discovery: {
    allowedHostnames: ['*.percy.io'],
    networkIdleTimeout: 100,
    disableAssetCache: false,
    concurrency: 1,
    launchOptions: {
      devtools: true
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
expectType<Percy>(await Percy.start());
expectType<Percy>(await Percy.start(percyOptions));

// #loglevel()
expectType<'error' | 'warn' | 'info' | 'debug' | 'silent'>(percy.loglevel());
expectType<void>(percy.loglevel('error'));

// #isRunning()
expectType<boolean>(percy.isRunning());

// #start()
expectType<void>(await percy.start());
// #stop()
expectType<void>(await percy.stop());

// #snapshot()
expectType<void>(await percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...',
  widths: [1000],
  minimumHeight: 1000,
  percyCSS: '.foo { font-weight: 900; }',
  requestHeaders: { 'x-testing': 'test' },
  enableJavaScript: true
}));

expectType<void>(await percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...'
}));

expectError(await percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...',
  foo: true
}));

expectError(await percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000'
}));

expectError(await percy.snapshot({
  name: 'test snapshot'
}));

expectError(await percy.snapshot());

// #capture()
expectType<void>(await percy.capture({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  waitFor: '.some-selector',
  execute: async page => {},
  snapshots: [{
    name: 'test 2',
    execute: async page => {}
  }],
  widths: [1000],
  minimumHeight: 1000,
  percyCSS: '.foo { font-weight: 900; }',
  requestHeaders: { 'x-testing': 'test' },
  enableJavaScript: true
}));

expectType<void>(await percy.capture({
  name: 'test snapshot',
  url: 'http://localhost:3000'
}))

expectType<void>(await percy.capture({
  url: 'http://localhost:3000',
  snapshots: [{
    name: 'test snapshot',
    execute: async page => {}
  }]
}))

expectError(await percy.capture({
  url: 'http://localhost:3000'
}))

expectError(await percy.capture({
  url: 'http://localhost:3000',
  snapshots: [{
    execute: async page => {}
  }]
}))

expectError(await percy.capture({
  url: 'http://localhost:3000',
  snapshots: [{
    name: 'test snapshot'
  }]
}))

expectError(await percy.capture({
  name: 'test snapshot'
}))

expectError(await percy.capture())
