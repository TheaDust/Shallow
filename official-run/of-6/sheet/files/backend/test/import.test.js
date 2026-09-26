'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createHandler } = require('../server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spreadsheet-import-test-'));
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

test('POST /api/import-csv creates a workbook named without .csv and Sheet1 with parsed cells', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const res = await client.request('POST', '/api/import-csv', {
    name: 'Sales Data.csv',
    csv: 'Region,Amount\nEast,1200\nNorth,800\n',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.name, 'Sales Data');
  assert.strictEqual(res.body.sheets.length, 1);
  assert.strictEqual(res.body.sheets[0].name, 'Sheet1');
  assert.strictEqual(res.body.sheets[0].cells.A1, 'Region');
  assert.strictEqual(res.body.sheets[0].cells.B1, 'Amount');
  assert.strictEqual(res.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(res.body.sheets[0].cells.B2, '1200');
  assert.strictEqual(res.body.sheets[0].cells.A3, 'North');
  assert.strictEqual(res.body.sheets[0].cells.B3, '800');
  assert.strictEqual(res.body.sheets[0].rowCount, 3);
  assert.strictEqual(res.body.sheets[0].columnCount, 2);
  assert.strictEqual(res.body.activeSheetId, res.body.sheets[0].id);
  assert.strictEqual(res.body.pivots.length, 0);

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.length, 2);
  assert.strictEqual(list.body[1].name, 'Sales Data');

  const reread = await client.request('GET', '/api/workbooks/' + res.body.id);
  assert.strictEqual(reread.status, 200);
  assert.strictEqual(reread.body.sheets[0].cells.A2, 'East');
  assert.strictEqual(reread.body.sheets[0].cells.A1, 'Region');
});

test('import preserves UTF-8 text, quoted commas, escaped quotes, line breaks and empty fields', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const res = await client.request('POST', '/api/import-csv', {
    name: '数据.csv',
    csv: '产品,备注,数量\n苹果,"a,b","说""你好""",\n香蕉,"第一行\n第二行",5\n',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.name, '数据');
  const cells = res.body.sheets[0].cells;
  assert.strictEqual(cells.A1, '产品');
  assert.strictEqual(cells.B1, '备注');
  assert.strictEqual(cells.C1, '数量');
  assert.strictEqual(cells.A2, '苹果');
  assert.strictEqual(cells.B2, 'a,b');
  assert.strictEqual(cells.C2, '说"你好"');
  assert.strictEqual(cells.A3, '香蕉');
  assert.strictEqual(cells.B3, '第一行\n第二行');
  assert.strictEqual(cells.C3, '5');
  // empty trailing field preserved as an empty column, not a missing one
  assert.strictEqual(res.body.sheets[0].columnCount, 4);
  assert.strictEqual(res.body.sheets[0].rowCount, 3);
});

test('a field that begins with a double quote but has no closing quote is rejected exactly', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const before = await client.request('GET', '/api/workbooks');
  const res = await client.request('POST', '/api/import-csv', {
    name: 'broken.csv',
    csv: 'a,"unclosed\nb',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Invalid CSV file format. Import failed.');

  const after = await client.request('GET', '/api/workbooks');
  assert.strictEqual(after.body.length, before.body.length);
  assert.strictEqual(after.body[0].name, 'Q3 Sales');

  const seed = await client.request('GET', '/api/workbooks/q3-sales');
  assert.strictEqual(seed.status, 200);
  assert.strictEqual(seed.body.name, 'Q3 Sales');
  assert.strictEqual(seed.body.sheets[0].cells.A1, '2');

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.body.some((wb) => wb.name === 'broken'), false);
});

test('import strips the final .csv extension case-insensitively', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const res = await client.request('POST', '/api/import-csv', {
    name: 'Report.CSV',
    csv: 'x\n',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.name, 'Report');
});

test('importing an empty CSV creates a Sheet1 with no cells', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const res = await client.request('POST', '/api/import-csv', {
    name: 'empty.csv',
    csv: '',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.name, 'empty');
  assert.strictEqual(res.body.sheets.length, 1);
  assert.strictEqual(res.body.sheets[0].name, 'Sheet1');
  assert.deepStrictEqual(res.body.sheets[0].cells, {});
  assert.strictEqual(res.body.activeSheetId, res.body.sheets[0].id);
});

test('import with an empty file name is rejected and adds no record', async (t) => {
  const { client } = await setup();
  t.after(() => client.close());

  const res = await client.request('POST', '/api/import-csv', {
    name: '   ',
    csv: 'a\n',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Workbook name cannot be empty');

  const list = await client.request('GET', '/api/workbooks');
  assert.strictEqual(list.body.length, 1);
});
