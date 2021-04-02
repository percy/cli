// create a testing context for mocking the local percy server and a local testing site
function context() {
  let createTestServer = require('@percy/core/test/helpers/server');

  let ctx = {
    async call(path, ...args) {
      let [key, ...paths] = path.split('.').reverse();
      let subject = paths.reduceRight((c, k) => c && c[k], ctx);
      if (!(subject && key in subject)) return;

      let { value, get, set } = Object
        .getOwnPropertyDescriptor(subject, key);

      if (typeof value === 'function') {
        value = await value.apply(subject, args);
      } else if (!get && !set && args.length) {
        value = subject[key] = args[0];
      } else if (set && args.length) {
        value = set.apply(subject, args);
      } else if (get) {
        value = get.apply(subject);
      }

      if (value && typeof value[Symbol.iterator] === 'function') {
        value = Array.from(value);
      }

      return value;
    }
  };

  let mockServer = async () => {
    let allowSocketConnections = false;

    let serializeDOM = options => {
      let { dom = document, domTransformation } = options || {};
      let doc = (dom || document).cloneNode(true).documentElement;
      if (domTransformation) domTransformation(doc);
      return doc.outerHTML;
    };

    if (ctx.server.close) ctx.server.close();
    ctx.server = Object.assign(await createTestServer({
      '/percy/dom.js': () => [200, 'application/javascript', (
        `window.PercyDOM = { serialize: ${serializeDOM} }`)],
      '/percy/healthcheck': () => [200, 'application/json', (
        { success: true, config: { snapshot: { widths: [1280] } } })],
      '/percy/snapshot': () => [200, 'application/json', { success: true }]
    }, 5338), {
      mock: mockServer,
      messages: [],

      reply: (url, route) => {
        ctx.server.routes[url] = (
          typeof route === 'function'
            ? route : () => route
        );
      },

      test: {
        get serialize() { return serializeDOM; },
        set serialize(fn) { return (serializeDOM = fn); },
        failure: (path, error) => ctx.server.reply(path, () => (
          [500, 'application/json', { success: false, error }])),
        error: path => ctx.server.reply(path, r => r.connection.destroy()),
        remote: () => (allowSocketConnections = true)
      }
    });

    ctx.wss = new (require('ws').Server)({ noServer: true });
    ctx.server.server.on('upgrade', (req, sock, head) => {
      if (allowSocketConnections) {
        ctx.wss.handleUpgrade(req, sock, head, socket => {
          socket.onmessage = ({ data }) => ctx.server.messages.push(data);
        });
      } else {
        sock.destroy();
      }
    });
  };

  let mockSite = async () => {
    if (ctx.site.close) ctx.site.close();
    ctx.site = Object.assign(await createTestServer({
      default: () => [200, 'text/html', 'Snapshot Me']
    }), { mock: mockSite });
  };

  ctx.server = { mock: mockServer };
  ctx.site = { mock: mockSite };

  ctx.mockAll = () => Promise.all([
    ctx.server.mock(),
    ctx.site.mock()
  ]);

  ctx.close = () => {
    if (ctx.server.close) ctx.server.close();
    if (ctx.site.close) ctx.site.close();
  };

  return ctx;
}

// start a testing server to control a context remotely
async function start(args, log) {
  let startSocketServer = (tries = 0) => new Promise((resolve, reject) => {
    let server = new (require('ws').Server)({ port: 5339 });
    server.on('listening', () => resolve(server)).on('error', reject);
  }).catch(err => {
    if (err.code === 'EADDRINUSE' && tries < 10) {
      return stop().then(() => startSocketServer(++tries));
    } else throw err;
  });

  let wss = await startSocketServer();
  let ctx = context();

  let close = () => {
    if (close.called) return;
    close.called = true;

    if (ctx) ctx.call('close');
    wss.close(() => log('info', 'Closed SDK testing server'));
  };

  wss.on('connection', ws => {
    ws.on('message', data => {
      if (data === 'CLOSE') return close();
      let { id, event, args = [] } = JSON.parse(data);

      Promise.resolve().then(async () => {
        let result = await ctx.call(event, ...args);
        ws.send(JSON.stringify({ id, resolve: { result } }));
        log('debug', `${event}: ${JSON.stringify({ args, result })}`);
      }).catch(err => {
        let error = { message: err.message, stack: err.stack };
        ws.send(JSON.stringify({ id, reject: { error } }));
        log('debug', `${event}: ${error.stack}`);
      });
    });
  });

  await ctx.call('mockAll');
  log('info', 'Started SDK testing server');
}

// stop any existing testing server
async function stop() {
  await new Promise(resolve => {
    let ws = new (require('ws'))('ws://localhost:5339');
    ws.on('open', () => ws.send('CLOSE'));
    ws.on('close', () => resolve());
  });
}

// start & stop a testing server around a command
function exec(args, log) {
  let argsep = args.indexOf('--');
  if (argsep < 0) throw new Error('Must supply a command after `--`');

  let startargs = args.slice(0, argsep);
  let [cmd, ...cmdargs] = args.slice(argsep + 1);

  return start(startargs, log).then(async () => {
    let { spawn } = require('child_process');
    spawn(cmd, cmdargs, { stdio: 'inherit' })
      .on('exit', process.exit)
      .on('error', error => {
        console.error(error);
        process.exit(1);
      });
  });
}

// allow invoking start/stop/exec as CLI commands
if (require.main === module) {
  let path = require('path');
  let { existsSync } = require('fs');
  let [,, cmd, ...args] = process.argv;

  let logger;
  if (existsSync(path.join(__dirname, '../src'))) {
    require('../../../scripts/babel-register');
    logger = require('@percy/logger/src');
  } else {
    logger = require('@percy/logger');
  }

  let run = { start, stop, exec }[cmd];
  let log = (lvl, msg) => logger('utils:test/server')[lvl](msg);

  if (run) {
    run(args, log).catch(console.error);
  } else {
    process.stderr.write(
      'usage: node test/server <start|stop|exec>\n'
    );
  }
}

module.exports.context = context;
module.exports.start = start;
module.exports.stop = stop;
module.exports.exec = exec;
