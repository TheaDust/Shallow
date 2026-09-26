'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

let dataDir;
let distDir;
let server;
let baseUrl;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-server-test-'));
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-dist-test-'));
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>'
  );
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("ok");');
  const app = createApp({ dataDir, distDir });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(distDir, { recursive: true, force: true });
});

test('health checks respond on /health and /api/health', async () => {
  for (const p of ['/health', '/api/health']) {
    const res = await fetch(`${baseUrl}${p}`);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.status, 'ok');
  }
});

test('root serves the frontend index.html', async () => {
  const res = await fetch(baseUrl);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('<div id="root"></div>'));
});

test('static assets are served from the dist directory', async () => {
  const res = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, 'console.log("ok");');
});

test('unknown paths return 404 without crashing', async () => {
  for (const p of ['/favicon.ico', '/no-such-page', '/api/no-such-api', '/assets/nope.js']) {
    const res = await fetch(`${baseUrl}${p}`);
    assert.equal(res.status, 404, `expected 404 for ${p}`);
  }
});

test('unknown API POST returns 404', async () => {
  const res = await fetch(`${baseUrl}/api/unknown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 404);
});

test('traversal outside the dist directory is rejected', async () => {
  const res = await fetch(`${baseUrl}/../package.json`);
  assert.equal(res.status, 404);
});
