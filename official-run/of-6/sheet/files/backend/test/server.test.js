'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createHandler } = require('../server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spreadsheet-backend-test-'));
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function makeClient(handler) {
  const { server, port } = await startServer(handler);
  const base = `http://127.0.0.1:${port}`;
  async function request(method, pathname, body) {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + pathname, init);
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = text;
    }
    return { status: res.status, body: data };
  }
  return {
    base,
    request,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function setup() {
  const dataDir = makeTempDir();
  const distDir = makeTempDir();
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body>app</body></html>');
  const client = await makeClient(createHandler({ dataDir, distDir }));
  return { client, dataDir, distDir };
}

test('health endpoints respond identically', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());
  const a = await client.request('GET', '/health');
  const b = await client.request('GET', '/api/health');
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(a.body, { status: 'ok' });
  assert.deepStrictEqual(b.body, { status: 'ok' });
});

test('empty data store is seeded with Q3 Sales / Sheet1+Sheet2 / A1=2 B1=3, formulas =A1+B1 =C1*2 and rows East/1200 North/800', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.length, 1);
  assert.strictEqual(list.body[0].name, 'Q3 Sales');
  assert.ok(list.body[0].id);
  assert.ok(list.body[0].lastUpdated);

  const detail = await client.request('GET', '/api/workbooks/' + list.body[0].id);
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.name, 'Q3 Sales');
  assert.strictEqual(detail.body.sheets.length, 2);
  assert.strictEqual(detail.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(detail.body.sheets[0].cells.A1, '2');
  assert.strictEqual(detail.body.sheets[0].cells.B1, '3');
  assert.strictEqual(detail.body.sheets[0].cells.C1, '=A1+B1');
  assert.strictEqual(detail.body.sheets[0].cells.D1, '=C1*2');
  assert.strictEqual(detail.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(detail.body.sheets[0].cells.B2, '1200');
  assert.strictEqual(detail.body.sheets[0].cells.A3, 'North');
  assert.strictEqual(detail.body.sheets[0].cells.B3, '800');
  assert.strictEqual(detail.body.sheets[0].cells.E2, undefined);
  assert.strictEqual(detail.body.sheets[1].name, 'Sheet2');
  assert.deepStrictEqual(detail.body.sheets[1].cells, {});
  assert.strictEqual(detail.body.activeSheetId, detail.body.sheets[0].id);
});

test('seed is not re-applied once the store exists', async (t) => {
  const dataDir = makeTempDir();
  const distDir = makeTempDir();
  const client = await makeClient(createHandler({ dataDir, distDir }));
  t.after(() => client.close());

  await client.request('GET', '/api/workbooks');
  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: 'Renamed',
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.name, 'Renamed');

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.body.length, 1);
  assert.strictEqual(list.body[0].name, 'Renamed');
});

test('PUT renames the workbook with trimming, keeps cells, and persists across reads', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: '  Q4 Sales  ',
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.name, 'Q4 Sales');
  assert.strictEqual(updated.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(updated.body.sheets[0].cells.A1, '2');

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body[0].name, 'Q4 Sales');

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.status, 200);
  assert.strictEqual(reread.body.name, 'Q4 Sales');
  assert.strictEqual(reread.body.sheets[0].cells.A1, '2');
  assert.strictEqual(reread.body.sheets[0].name, 'Sheet1');
});

test('PUT persists cell edits and updates lastUpdated atomically', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const editedSheets = before.body.sheets.map((sheet) => ({
    ...sheet,
    cells: { ...sheet.cells, A2: 'East', B2: '1200', A3: 'North', B3: '800' },
  }));
  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: before.body.activeSheetId,
    sheets: editedSheets,
    pivots: before.body.pivots,
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.sheets[0].cells.A1, '2');
  assert.strictEqual(updated.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(updated.body.sheets[0].cells.B2, '1200');
  assert.strictEqual(updated.body.sheets[0].cells.A3, 'North');
  assert.strictEqual(updated.body.sheets[0].cells.B3, '800');
  assert.notStrictEqual(updated.body.lastUpdated, before.body.lastUpdated);

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(reread.body.sheets[0].cells.B3, '800');
  assert.strictEqual(reread.body.sheets[0].cells.A1, '2');
});

test('POST /api/workbooks creates a blank workbook with only Sheet1 active and no cells', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const created = await client.request('POST', '/api/workbooks', {
    name: '  Untitled workbook  ',
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.name, 'Untitled workbook');
  assert.strictEqual(created.body.sheets.length, 1);
  assert.strictEqual(created.body.sheets[0].name, 'Sheet1');
  assert.deepStrictEqual(created.body.sheets[0].cells, {});
  assert.strictEqual(created.body.sheets[0].filterViews.length, 0);
  assert.strictEqual(created.body.sheets[0].validationRules.length, 0);
  assert.strictEqual(created.body.activeSheetId, created.body.sheets[0].id);
  assert.strictEqual(created.body.pivots.length, 0);

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.length, 2);
  assert.strictEqual(list.body[1].name, 'Untitled workbook');

  const reread = await client.request('GET', '/api/workbooks/' + created.body.id);
  assert.strictEqual(reread.status, 200);
  assert.strictEqual(reread.body.name, 'Untitled workbook');
  assert.strictEqual(reread.body.sheets.length, 1);
  assert.strictEqual(reread.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(reread.body.sheets[0].cells.A1, undefined);
  assert.strictEqual(reread.body.activeSheetId, reread.body.sheets[0].id);
});

test('POST /api/workbooks rejects an empty name and adds no record', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const bad = await client.request('POST', '/api/workbooks', { name: '   ' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'Workbook name cannot be empty');

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.length, 1);
  assert.strictEqual(list.body[0].name, 'Q3 Sales');

  const missing = await client.request('POST', '/api/workbooks', {});
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(missing.body.error, 'Workbook name cannot be empty');

  const after = await client.request('GET', '/api/workbooks');
  assert.strictEqual(after.body.length, 1);
});

test('POST /api/workbooks persists the created workbook across reads (refresh equivalent)', async (t) => {
  const { client, dataDir } = await setup();
  t.after(() => client.close());

  const created = await client.request('POST', '/api/workbooks', { name: 'Fresh Book' });
  assert.strictEqual(created.status, 201);

  const file = require('node:fs').readFileSync(require('node:path').join(dataDir, 'workbooks.json'), 'utf8');
  const store = JSON.parse(file);
  assert.strictEqual(store.length, 2);
  assert.strictEqual(store[1].name, 'Fresh Book');
  assert.strictEqual(store[1].sheets.length, 1);
  assert.strictEqual(store[1].sheets[0].name, 'Sheet1');
});

test('empty workbook name is rejected and does not change the store', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const bad = await client.request('PUT', '/api/workbooks/q3-sales', { name: '   ' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'Workbook name cannot be empty');

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.body.name, 'Q3 Sales');
  assert.strictEqual(reread.body.sheets[0].cells.A1, '2');
});

test('PUT rejects an empty worksheet name and keeps the original state', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const sheets = before.body.sheets.map((sheet) =>
    sheet.id === 'sheet1' ? { ...sheet, name: '   ' } : sheet
  );
  const bad = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: before.body.activeSheetId,
    sheets,
    pivots: before.body.pivots,
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'Worksheet name cannot be empty');

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.body.sheets.length, 2);
  assert.strictEqual(reread.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(reread.body.sheets[0].cells.A1, '2');
  assert.strictEqual(reread.body.sheets[0].cells.A2, 'East');
});

test('PUT rejects a duplicate worksheet name and keeps the original state', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const sheets = before.body.sheets.map((sheet) =>
    sheet.id === 'sheet1' ? { ...sheet, name: 'Sheet2' } : sheet
  );
  const bad = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: before.body.activeSheetId,
    sheets,
    pivots: before.body.pivots,
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'Worksheet name already exists');

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.body.sheets.length, 2);
  assert.strictEqual(reread.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(reread.body.sheets[1].name, 'Sheet2');
  assert.strictEqual(reread.body.sheets[0].cells.A1, '2');
  assert.strictEqual(reread.body.sheets[0].cells.A2, 'East');
});

test('PUT renames a worksheet, trims the name, and persists the new tab name', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const sheets = before.body.sheets.map((sheet) =>
    sheet.id === 'sheet1' ? { ...sheet, name: '  Q3 Overview  ' } : sheet
  );
  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: before.body.activeSheetId,
    sheets,
    pivots: before.body.pivots,
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.sheets[0].name, 'Q3 Overview');
  assert.strictEqual(updated.body.sheets[0].cells.A1, '2');
  assert.strictEqual(updated.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(updated.body.activeSheetId, 'sheet1');

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.status, 200);
  assert.strictEqual(reread.body.sheets[0].name, 'Q3 Overview');
  assert.strictEqual(reread.body.sheets[0].cells.B3, '800');
});

test('PUT allows renaming a sheet to a name that matches its own current name', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: before.body.activeSheetId,
    sheets: before.body.sheets,
    pivots: before.body.pivots,
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.sheets[0].name, 'Sheet1');
});

test('PUT adds a blank worksheet, makes it active, keeps existing sheets and persists', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const newSheet = {
    id: 'sheet-new-1',
    name: 'Sheet3',
    rowCount: before.body.sheets[0].rowCount,
    columnCount: before.body.sheets[0].columnCount,
    cells: {},
    filterViews: [],
    validationRules: [],
  };
  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: newSheet.id,
    sheets: [...before.body.sheets, newSheet],
    pivots: before.body.pivots,
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.sheets.length, 3);
  assert.strictEqual(updated.body.sheets[1].name, 'Sheet2');
  assert.strictEqual(updated.body.sheets[2].name, 'Sheet3');
  assert.deepStrictEqual(updated.body.sheets[2].cells, {});
  assert.deepStrictEqual(updated.body.sheets[2].filterViews, []);
  assert.deepStrictEqual(updated.body.sheets[2].validationRules, []);
  assert.strictEqual(updated.body.activeSheetId, newSheet.id);
  assert.strictEqual(updated.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(updated.body.sheets[0].cells.A1, '2');
  assert.strictEqual(updated.body.sheets[0].cells.B3, '800');

  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.status, 200);
  assert.strictEqual(reread.body.sheets.length, 3);
  assert.strictEqual(reread.body.sheets[1].name, 'Sheet2');
  assert.strictEqual(reread.body.sheets[2].name, 'Sheet3');
  assert.deepStrictEqual(reread.body.sheets[2].cells, {});
  assert.strictEqual(reread.body.activeSheetId, newSheet.id);
  assert.strictEqual(reread.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(reread.body.sheets[0].cells.B3, '800');
});

test('PUT persists the per-sheet selection rectangle and returns it on read', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks/q3-sales');
  const sheets = before.body.sheets.map((sheet, index) => ({
    ...sheet,
    selection: { anchor: 'D1', active: 'E2' },
  }));
  const updated = await client.request('PUT', '/api/workbooks/q3-sales', {
    name: before.body.name,
    activeSheetId: before.body.activeSheetId,
    sheets,
    pivots: before.body.pivots,
  });
  assert.strictEqual(updated.status, 200);
  assert.deepStrictEqual(updated.body.sheets[0].selection, { anchor: 'D1', active: 'E2' });

  // the stored rectangles survive re-reads (refresh equivalent)
  const reread = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(reread.status, 200);
  assert.deepStrictEqual(reread.body.sheets[0].selection, { anchor: 'D1', active: 'E2' });
  assert.strictEqual(reread.body.sheets[0].cells.A1, '2');
});

test('unknown API and static paths return 404 without crashing', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const api = await client.request('GET', '/api/unknown');
  assert.strictEqual(api.status, 404);

  const wb = await client.request('GET', '/api/workbooks/does-not-exist');
  assert.strictEqual(wb.status, 404);

  const favicon = await client.request('GET', '/favicon.ico');
  assert.strictEqual(favicon.status, 404);

  const random = await client.request('GET', '/some/random/path');
  assert.strictEqual(random.status, 404);
});

test('GET / serves the frontend build and assets resolve', async (t) => {
  const { client, distDir } = await setup();
  t.after(() => client.close());

  fs.writeFileSync(path.join(distDir, 'app.js'), 'console.log(1)');
  const home = await client.request('GET', '/');
  assert.strictEqual(home.status, 200);
  assert.strictEqual(home.body, '<!doctype html><html><body>app</body></html>');

  const asset = await client.request('GET', '/app.js');
  assert.strictEqual(asset.status, 200);
  assert.strictEqual(asset.body, 'console.log(1)');
});
