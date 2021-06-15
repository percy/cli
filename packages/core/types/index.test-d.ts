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
    disableCache: true
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
