import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { provisionSeed } from './seed.js';
import * as auth from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
const DATA_DIR = process.env.SHALLOW_DATA_DIR || path.resolve(__dirname, '../data');

const PORT = Number(process.env.PORT || 3000);
const EXTRA_PORTS = process.env.ARC_EXTRA_PORTS === '0' ? [] : [3301];

const store = createStore(DATA_DIR);
provisionSeed(store);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

function sessionUser(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.session_id;
  if (!sessionId) return null;
  const session = store.findSessionById(sessionId);
  if (!session || !session.active) return null;
  const account = store.findAccountById(session.accountId);
  if (!account || account.status !== 'active') return null;
  return { id: account.id, username: account.username, email: account.email };
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/session') {
    const user = sessionUser(req);
    return sendJson(res, 200, { user });
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Invalid request body' });
    }
    const result = auth.register(store, input);
    if (!result.ok) return sendJson(res, 422, { ok: false, fieldErrors: result.fieldErrors });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/auth/signin') {
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Invalid request body' });
    }
    const result = auth.signIn(store, input);
    if (!result.ok) return sendJson(res, 401, { ok: false, message: result.message });
    const cookie = `session_id=${encodeURIComponent(result.session.id)}; HttpOnly; Path=/; SameSite=Lax`;
    res.setHeader('Set-Cookie', cookie);
    return sendJson(res, 200, { ok: true, user: result.user });
  }

  if (req.method === 'POST' && pathname === '/api/auth/change-password') {
    const account = sessionUser(req);
    if (!account) {
      return sendJson(res, 401, { ok: false, message: 'Not signed in' });
    }
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Invalid request body' });
    }
    const result = auth.changePassword(store, account.id, input);
    if (!result.ok) {
      if (result.fieldErrors) {
        return sendJson(res, 422, { ok: false, fieldErrors: result.fieldErrors });
      }
      return sendJson(res, 401, { ok: false, message: result.message });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/auth/signout') {
    const cookies = parseCookies(req);
    const sessionId = cookies.session_id;
    if (sessionId) store.invalidateSession(sessionId);
    res.setHeader('Set-Cookie', 'session_id=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/auth/recover-request') {
    const result = auth.recoverRequest(store, {});
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && pathname === '/api/auth/recover-reset') {
    let input;
    try {
      input = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Invalid request body' });
    }
    const result = auth.recoverReset(store, input);
    if (!result.ok) return sendJson(res, 422, { ok: false, fieldErrors: result.fieldErrors });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, message: 'Not found' });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const resolved = path.normalize(path.join(FRONTEND_DIST, pathname));
  if (!resolved.startsWith(FRONTEND_DIST)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': fs.statSync(resolved).size,
  });
  fs.createReadStream(resolved).pipe(res);
}

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/health' || pathname === '/api/health')) {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res);
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

const servers = [];
function start() {
  const ports = [...new Set([PORT, ...EXTRA_PORTS])];
  for (const port of ports) {
    const server = http.createServer(handler);
    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`backend listening on http://0.0.0.0:${port}`);
    });
    server.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`failed to listen on ${port}:`, err.message);
    });
    servers.push(server);
  }
}

start();
