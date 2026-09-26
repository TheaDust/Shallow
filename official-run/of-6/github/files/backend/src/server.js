'use strict';

const http = require('http');
const path = require('path');
const { createApp } = require('./app');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const EXTRA_PORTS = [3301];

const dataDir =
  process.env.SHALLOW_DATA_DIR || path.join(__dirname, '..', 'data');
const distDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');

const handler = createApp({ dataDir, distDir });

const mainServer = http.createServer(handler);
mainServer.listen(PORT, () => {
  process.stdout.write(`[server] listening on port ${PORT}\n`);
});

// The platform contract requires PORT and the hardcoded acceptance port to
// serve the same application. Each port gets its own http.Server instance.
if (process.env.ARC_EXTRA_PORTS !== '0') {
  for (const extraPort of EXTRA_PORTS) {
    if (extraPort === PORT) {
      continue;
    }
    const extraServer = http.createServer(handler);
    extraServer.listen(extraPort, () => {
      process.stdout.write(`[server] listening on extra port ${extraPort}\n`);
    });
  }
}
