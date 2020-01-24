import express from 'express';
import { startServer } from '../../src/server';

export default async function createTestServer(port = 8000) {
  let app = express();
  let requests = [];

  app.use('*', (req, res, next) => {
    requests.push(req);
    next();
  });

  let server = await startServer(app, port);
  return { app, requests, close: () => server.close() };
}
