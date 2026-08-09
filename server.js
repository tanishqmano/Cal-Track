#!/usr/bin/env node
'use strict';

/**
 * Local server for the macro tracker.
 *
 *   - Serves public/ (the page, its stylesheets and its modules)
 *   - Reads the selected provider's API key from .env and injects it into calls
 *   - Holds the food log so every device shares one copy, in a JSON file or in
 *     MongoDB depending on STORE in .env
 *
 * The key never reaches the browser. The page posts to /api/parse on its own
 * origin; this process adds the auth header and forwards it upstream.
 *
 * Run with:  node server.js
 *
 * Where things live:
 *
 *   src/config/   .env parsing, paths, spend limits, the provider table
 *   src/store/    the log, as a JSON file or a MongoDB document
 *   src/http/     responses, the passphrase gate, static files, the route map
 *   src/routes/   one file per endpoint
 *   src/          the token meter and the startup banner
 *
 * This file stays at the root and stays thin: `node server.js` is the start
 * command on the host, so moving it would mean editing the deploy too.
 */

const { createServer } = require('./src/http/router');
const { printBanner } = require('./src/banner');

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '0.0.0.0';

createServer().listen(PORT, HOST, () => printBanner(PORT));
