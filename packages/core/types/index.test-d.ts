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
    minHeight: 1024,
    percyCSS: '.percy { color: purple; }',
    enableJavaScript: false
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

// #isRunning()
expectType<boolean>(percy.isRunning());

// #start()
expectType<Promise<void>>(percy.start());
// #stop()
expectType<Promise<void>>(percy.stop());
// #idle()
expectType<Promise<void>>(percy.idle());

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
    disableCache: true
  }
}));

expectType<Promise<void>>(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...'
}));

expectError(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  domSnapshot: '...',
  foo: true
}));

expectError(percy.snapshot({
  name: 'test snapshot',
  url: 'http://localhost:3000'
}));

expectError(percy.snapshot({
  name: 'test snapshot'
}));

expectError(percy.snapshot());

// #capture()
expectType<Promise<void>>(percy.capture({
  name: 'test snapshot',
  url: 'http://localhost:3000',
  waitForTimeout: 1000,
  waitForSelector: '.some-selector',
  execute() {},
  snapshots: [{
    name: 'test 2',
    async execute() {}
  }],
  widths: [1000],
  minHeight: 1000,
  percyCSS: '.foo { font-weight: 900; }',
  enableJavaScript: true,
  discovery: {
    authorization: { username: 'u', password: '*' },
    requestHeaders: { 'x-testing': 'test' }
  }
}));

expectType<Promise<void>>(percy.capture({
  name: 'test snapshot',
  url: 'http://localhost:3000'
}))

expectType<Promise<void>>(percy.capture({
  url: 'http://localhost:3000',
  snapshots: [{
    name: 'test snapshot',
    execute() {}
  }]
}))

expectError(percy.capture({
  url: 'http://localhost:3000'
}))

expectError(percy.capture({
  url: 'http://localhost:3000',
  snapshots: [{
    execute() {}
  }]
}))

expectError(percy.capture({
  url: 'http://localhost:3000',
  snapshots: [{
    name: 'test snapshot'
  }]
}))

expectError(percy.capture({
  name: 'test snapshot'
}))

expectError(percy.capture())
