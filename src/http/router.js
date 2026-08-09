'use strict';

/**
 * One place that says which URL does what. Every route body lives in
 * src/routes/; this file is only the map, so it stays readable at a glance.
 */

const http = require('http');
const { json } = require('./respond');
const { authorized, throttled, noteMiss } = require('./auth');
const staticFiles = require('./static');
const { health } = require('../routes/health');
const { getState, putState } = require('../routes/state');
const { parseFood } = require('../routes/parse');

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;

    if (route === '/api/health' && req.method === 'GET') {
      return health(req, res);
    }

    // Everything past here touches either the log or the API key. The check runs
    // before the throttle, so the right passphrase always gets through — being
    // guessed at should never cost the owner access.
    if (route === '/api/parse' || route === '/api/state') {
      if (!authorized(req)) {
        if (throttled(req)) {
          return json(res, 429, { error: { message: 'Too many wrong passphrases. Wait a minute.' } });
        }
        noteMiss(req);
        return json(res, 401, { error: { message: 'Passphrase required' } });
      }
    }

    if (route === '/api/parse') {
      if (req.method !== 'POST') return json(res, 405, { error: { message: 'Use POST' } });
      return parseFood(req, res);
    }

    if (route === '/api/state') {
      if (req.method === 'GET') return getState(res);
      if (req.method === 'PUT') return putState(req, res);
      return json(res, 405, { error: { message: 'Use GET or PUT' } });
    }

    // The page was a single macro-tracker.html before it was split into
    // public/. Anything bookmarked on a phone still points at the old name.
    if (route === '/macro-tracker.html') {
      res.writeHead(301, { location: '/' });
      return res.end();
    }

    // Only public/ is reachable, and only these two methods reach it.
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (staticFiles.serve(req, res, route)) return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
}

module.exports = { createServer };
