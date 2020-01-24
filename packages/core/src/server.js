// Lazily creates and returns an express app for communicating with the Percy
// instance using a local API
export function createServerApp(percy) {
  // lazily required to speed up imports when the server is not needed
  let express = require('express');
  let cors = require('cors');
  let bodyParser = require('body-parser');

  return express()
    .use(cors())
    .use(bodyParser.urlencoded({ extended: true }))
    .use(bodyParser.json({ limit: '50mb' }))
  // healthcheck returns meta info as well
    .get('/percy/healthcheck', (_, res) => {
      res.json({
        success: true,
        build: percy.client.build,
        config: percy.config
      });
    })
  // snapshots are not awaited on for concurrent requests
    .post('/percy/snapshot', (req, res) => {
      percy.snapshot(req.body);
      res.json({ success: true });
    })
  // stops the instance
    .post('/percy/stop', async (_, res) => {
      await percy.stop();
      res.json({ success: true });
    })
  // serves @percy/dom as a convenience
    .get('/percy/dom.js', (_, res) => {
      res.sendFile(require.resolve('@percy/dom'));
    })
  // other routes 404
    .use('*', (_, res) => {
      res.status(404).json({ success: false, error: 'Not found' });
    })
  // generic error handler
    .use(({ message }, req, res, next) => {
      res.status(500).send({ success: false, error: message });
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
