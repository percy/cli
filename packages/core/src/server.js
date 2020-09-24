// Handles async routes with a middleware pattern to catch and forward errors
function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// Lazily creates and returns an express app for communicating with the Percy
// instance using a local API
export function createServerApp(percy) {
  // lazily required to speed up imports when the server is not needed
  let express = require('express');
  let cors = require('cors');

  return express()
    .use(cors())
    .use(express.urlencoded({ extended: true }))
    .use(express.json({ limit: '50mb' }))
  // healthcheck returns meta info as well
    .get('/percy/healthcheck', (_, res) => {
      res.json({
        success: true,
        config: percy.config,
        loglevel: percy.loglevel(),
        build: percy.client.build
      });
    })
  // responds when idle
    .get('/percy/idle', asyncRoute(async (_, res) => {
      await percy.idle();
      res.json({ success: true });
    }))
  // serves @percy/dom as a convenience
    .get('/percy/dom.js', (_, res) => {
      res.sendFile(require.resolve('@percy/dom'));
    })
  // forward snapshot requests
    .post('/percy/snapshot', asyncRoute(async (req, res) => {
      await percy.snapshot(req.body);
      res.json({ success: true });
    }))
  // stops the instance
    .post('/percy/stop', asyncRoute(async (_, res) => {
      await percy.stop();
      res.json({ success: true });
    }))
  // other routes 404
    .use('*', (_, res) => {
      res.status(404).json({ success: false, error: 'Not found' });
    })
  // generic error handler
    .use(({ message }, req, res, next) => {
      res.status(500).json({ success: false, error: message });
    });
}

// Promised based helper for starting an app at the specified port. Resolves
// when the server is listening, rejects if there are any errors when starting.
export function startServer(app, port) {
  return new Promise((resolve, reject) => {
    let server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}
