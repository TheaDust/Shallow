'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { parseCsv, cellCoordinate } = require('./csv');

const DEFAULT_PORT = 3000;
const EXTRA_PORT = 3301;
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DIST_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveDataDir() {
  if (process.env.SHALLOW_DATA_DIR) {
    return process.env.SHALLOW_DATA_DIR;
  }
  return DEFAULT_DATA_DIR;
}

function seedStore() {
  const now = new Date().toISOString();
  return [
    {
      id: 'q3-sales',
      name: 'Q3 Sales',
      lastUpdated: now,
      activeSheetId: 'sheet1',
      sheets: [
        {
          id: 'sheet1',
          name: 'Sheet1',
          rowCount: 20,
          columnCount: 6,
          cells: {
            A1: '2',
            B1: '3',
            C1: '=A1+B1',
            D1: '=C1*2',
            A2: 'East',
            B2: '1200',
            A3: 'North',
            B3: '800',
          },
          filterViews: [],
          validationRules: [],
        },
        {
          id: 'sheet2',
          name: 'Sheet2',
          rowCount: 20,
          columnCount: 6,
          cells: {},
          filterViews: [],
          validationRules: [],
        },
      ],
      pivots: [],
    },
  ];
}

function loadStore(dataDir) {
  const file = path.join(dataDir, 'workbooks.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    throw new Error('Workbook data store is corrupt: ' + err.message);
  }
}

function saveStore(dataDir, store) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'workbooks.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getStore(dataDir) {
  let store = loadStore(dataDir);
  if (store === null || store.length === 0) {
    store = seedStore();
    saveStore(dataDir, store);
  }
  return store;
}

function createBlankWorkbook(name) {
  const now = new Date().toISOString();
  const id = 'wb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const sheetId = 'sheet-' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    name,
    lastUpdated: now,
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        name: 'Sheet1',
        rowCount: 20,
        columnCount: 6,
        cells: {},
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

function createImportedWorkbook(name, rows) {
  const now = new Date().toISOString();
  const id = 'wb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const sheetId = 'sheet-' + Math.random().toString(36).slice(2, 8);
  const cells = {};
  let maxColumns = 0;
  rows.forEach((row, r) => {
    if (row.length > maxColumns) {
      maxColumns = row.length;
    }
    row.forEach((value, c) => {
      if (value !== '') {
        cells[cellCoordinate(r, c)] = value;
      }
    });
  });
  return {
    id,
    name,
    lastUpdated: now,
    activeSheetId: sheetId,
    sheets: [
      {
        id: sheetId,
        name: 'Sheet1',
        rowCount: Math.max(rows.length, 1),
        columnCount: Math.max(maxColumns, 1),
        cells,
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

function applyWorkbookUpdate(current, body) {
  const next = Object.assign({}, current, {
    sheets: Array.isArray(current.sheets) ? current.sheets.map((sheet) => Object.assign({}, sheet)) : [],
    pivots: Array.isArray(current.pivots) ? current.pivots.slice() : [],
  });

  if (body && typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) {
      const err = new Error('Workbook name cannot be empty');
      err.status = 400;
      throw err;
    }
    next.name = name;
  }
  if (body && typeof body.activeSheetId === 'string') {
    next.activeSheetId = body.activeSheetId;
  }
  if (body && Array.isArray(body.sheets)) {
    const seenNames = new Set();
    for (const sheet of body.sheets) {
      if (!sheet || typeof sheet.name !== 'string' || !sheet.name.trim()) {
        const err = new Error('Worksheet name cannot be empty');
        err.status = 400;
        throw err;
      }
      const trimmedName = sheet.name.trim();
      if (seenNames.has(trimmedName)) {
        const err = new Error('Worksheet name already exists');
        err.status = 400;
        throw err;
      }
      seenNames.add(trimmedName);
    }
    next.sheets = body.sheets.map((sheet) =>
      Object.assign({}, sheet, { name: sheet.name.trim() })
    );
  }
  if (body && Array.isArray(body.pivots)) {
    next.pivots = body.pivots;
  }
  next.lastUpdated = new Date().toISOString();
  return next;
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname, distDir) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(distDir, rel);
  if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
  });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Not found');
  });
  stream.pipe(res);
}

function createHandler(options) {
  const opts = options || {};
  const dataDir = opts.dataDir || resolveDataDir();
  const distDir = opts.distDir || DIST_DIR;

  return function handler(req, res) {
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname;

    Promise.resolve()
      .then(async () => {
        if (pathname === '/health' || pathname === '/api/health') {
          return jsonResponse(res, 200, { status: 'ok' });
        }

        if (pathname === '/api/workbooks' && req.method === 'GET') {
          const store = getStore(dataDir);
          const summaries = store.map((wb) => ({
            id: wb.id,
            name: wb.name,
            lastUpdated: wb.lastUpdated,
          }));
          return jsonResponse(res, 200, summaries);
        }

        if (pathname === '/api/workbooks' && req.method === 'POST') {
          const raw = await readBody(req);
          let body = {};
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch (err) {
              return jsonResponse(res, 400, { error: 'Invalid JSON body' });
            }
          }
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) {
            return jsonResponse(res, 400, { error: 'Workbook name cannot be empty' });
          }
          const store = getStore(dataDir);
          const created = createBlankWorkbook(name);
          store.push(created);
          saveStore(dataDir, store);
          return jsonResponse(res, 201, created);
        }

        if (pathname === '/api/import-csv' && req.method === 'POST') {
          const raw = await readBody(req);
          let body = {};
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch (err) {
              return jsonResponse(res, 400, { error: 'Invalid JSON body' });
            }
          }
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) {
            return jsonResponse(res, 400, { error: 'Workbook name cannot be empty' });
          }
          const csv = typeof body.csv === 'string' ? body.csv : '';
          let rows;
          try {
            rows = parseCsv(csv);
          } catch (err) {
            return jsonResponse(res, 400, { error: err.message });
          }
          const workbookName = name.replace(/\.csv$/i, '').trim() || name.trim();
          const store = getStore(dataDir);
          const created = createImportedWorkbook(workbookName, rows);
          store.push(created);
          saveStore(dataDir, store);
          return jsonResponse(res, 201, created);
        }

        const match = pathname.match(/^\/api\/workbooks\/([^/]+)$/);
        if (match) {
          const id = decodeURIComponent(match[1]);
          const store = getStore(dataDir);
          const index = store.findIndex((wb) => wb.id === id);
          if (index === -1) {
            return jsonResponse(res, 404, { error: 'Workbook not found' });
          }
          if (req.method === 'GET') {
            return jsonResponse(res, 200, store[index]);
          }
          if (req.method === 'PUT') {
            const raw = await readBody(req);
            let body = {};
            if (raw) {
              try {
                body = JSON.parse(raw);
              } catch (err) {
                return jsonResponse(res, 400, { error: 'Invalid JSON body' });
              }
            }
            const updated = applyWorkbookUpdate(store[index], body);
            store[index] = updated;
            saveStore(dataDir, store);
            return jsonResponse(res, 200, updated);
          }
          return jsonResponse(res, 405, { error: 'Method not allowed' });
        }

        if (pathname.startsWith('/api/')) {
          return jsonResponse(res, 404, { error: 'Not found' });
        }

        serveStatic(req, res, pathname, distDir);
        return undefined;
      })
      .catch((err) => {
        if (err && err.status) {
          return jsonResponse(res, err.status, { error: err.message });
        }
        return jsonResponse(res, 500, { error: 'Internal server error' });
      });
  };
}

function start() {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const skipExtra = process.env.ARC_EXTRA_PORTS === '0';
  const handler = createHandler();

  const mainServer = http.createServer(handler);
  mainServer.listen(port);
  console.log('Spreadsheet backend listening on port ' + port);

  const servers = [mainServer];

  if (!skipExtra && EXTRA_PORT !== port) {
    const extraServer = http.createServer(handler);
    extraServer.on('error', (err) => {
      console.error('Extra port ' + EXTRA_PORT + ' unavailable: ' + err.message);
    });
    extraServer.listen(EXTRA_PORT);
    console.log('Spreadsheet backend also listening on port ' + EXTRA_PORT);
    servers.push(extraServer);
  }

  return servers;
}

if (require.main === module) {
  start();
}

module.exports = {
  createHandler,
  start,
  seedStore,
  applyWorkbookUpdate,
  createBlankWorkbook,
  createImportedWorkbook,
};
