import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";
import { SEED_WORKBOOK_ID } from "../src/lib/seed.mjs";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-api-"));
  const repository = createWorkbookRepository(directory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    directory,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function getJson(base, path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
}

test("seeds the shared initial workbook and serves it to the editor entry", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const list = await getJson(server.base, "/api/workbooks");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.workbooks.map((workbook) => workbook.name), ["Q3 Sales"]);

  const opened = await getJson(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.workbook.name, "Q3 Sales");
  assert.equal(opened.body.workbook.worksheets[0].name, "Sheet1");
  assert.equal(opened.body.workbook.worksheets[0].cells.A1.value, "Region");
  assert.equal(opened.body.workbook.activeWorksheetId, opened.body.workbook.worksheets[0].id);
});

test("creates a blank workbook with Sheet1 active and no other worksheet", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await fetch(`${server.base}/api/workbooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "  Budget  " }),
  });
  assert.equal(created.status, 201);
  const { workbook } = await created.json();
  assert.equal(workbook.name, "Budget");
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].name, "Sheet1");
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
  assert.deepEqual(workbook.worksheets[0].cells, {});

  const reloaded = await getJson(server.base, `/api/workbooks/${workbook.id}`);
  assert.equal(reloaded.body.workbook.name, "Budget");
  assert.deepEqual(reloaded.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1"]);

  const blank = await fetch(`${server.base}/api/workbooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "   " }),
  });
  assert.equal(blank.status, 201);
  assert.equal((await blank.json()).workbook.name, "Untitled workbook");

  const list = await getJson(server.base, "/api/workbooks");
  assert.deepEqual(list.body.workbooks.map((workbook) => workbook.name).sort(), ["Budget", "Q3 Sales", "Untitled workbook"]);
});

test("persists cell edits, active worksheet changes and rejects invalid addresses", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const workbook = (await getJson(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`)).body.workbook;
  const sheetId = workbook.worksheets[0].id;

  const saved = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheetId}/cells/B4`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "West" }),
  });
  assert.equal(saved.status, 200);
  const updated = (await saved.json()).workbook;
  assert.equal(updated.worksheets[0].cells.B4.value, "West");
  assert.equal(updated.worksheets[0].cells.A1.value, "Region");

  const reloaded = await getJson(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`);
  assert.equal(reloaded.body.workbook.worksheets[0].cells.B4.value, "West");

  const cleared = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheetId}/cells/B4`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "" }),
  });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).workbook.worksheets[0].cells.B4, undefined);

  const invalid = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${sheetId}/cells/nope`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x" }),
  });
  assert.equal(invalid.status, 400);

  const renamed = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "   " }),
  });
  assert.equal(renamed.status, 400);
  assert.equal((await renamed.json()).error, "Workbook name cannot be empty");
  assert.equal((await getJson(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`)).body.workbook.name, "Q3 Sales");
});

test("renames a workbook and rejects a blank name without changing the stored one", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const renamed = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "  Q4 Forecast  " }),
  });
  assert.equal(renamed.status, 200);
  const { workbook } = await renamed.json();
  assert.equal(workbook.name, "Q4 Forecast");
  assert.equal(workbook.worksheets[0].name, "Sheet1");
  assert.equal(workbook.worksheets[0].cells.A1.value, "Region");

  const list = await getJson(server.base, "/api/workbooks");
  assert.deepEqual(list.body.workbooks.map((entry) => entry.name), ["Q4 Forecast"]);

  const reopened = await getJson(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`);
  assert.equal(reopened.body.workbook.name, "Q4 Forecast");
  assert.equal(reopened.body.workbook.worksheets[0].cells.A1.value, "Region");

  const rejected = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "   " }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Workbook name cannot be empty");
  assert.equal((await getJson(server.base, `/api/workbooks/${SEED_WORKBOOK_ID}`)).body.workbook.name, "Q4 Forecast");
});

test("imports CSV data completely and keeps it after reload", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const csv = '地区,备注,数量\n华东,"东, 1",1200\n"他说 ""好""","多行\n备注",800\n,,\n';
  const imported = await fetch(`${server.base}/api/workbooks/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "Q3 明细.csv", content: csv }),
  });
  assert.equal(imported.status, 201);
  const { workbook } = await imported.json();
  assert.equal(workbook.name, "Q3 明细");
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, "Sheet1");
  assert.equal(sheet.cells.A1.value, "地区");
  assert.equal(sheet.cells.C2.value, "1200");
  assert.equal(sheet.cells.B3.value, "多行\n备注");
  assert.equal(sheet.cells.A3.value, '他说 "好"');
  assert.equal(sheet.cells.A4, undefined);
  assert.ok(sheet.rowCount >= 4);
  assert.ok(sheet.columnCount >= 3);

  const reloaded = await getJson(server.base, `/api/workbooks/${workbook.id}`);
  assert.deepEqual(reloaded.body.workbook.worksheets[0].cells, sheet.cells);
  assert.equal(reloaded.body.workbook.activeWorksheetId, sheet.id);
});

test("rejects an invalid CSV without keeping a partial workbook", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = (await getJson(server.base, "/api/workbooks")).body.workbooks;
  const failed = await fetch(`${server.base}/api/workbooks/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "broken.csv", content: 'a,b\n"unclosed,2\n' }),
  });
  assert.equal(failed.status, 400);
  assert.equal((await failed.json()).error, "Invalid CSV file format. Import failed.");
  const after = (await getJson(server.base, "/api/workbooks")).body.workbooks;
  assert.deepEqual(after, before);
});

test("answers health, unknown api and unknown asset paths without exiting", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.deepEqual(await getJson(server.base, "/health"), { status: 200, body: { ok: true } });
  assert.deepEqual(await getJson(server.base, "/api/health"), { status: 200, body: { ok: true } });
  assert.equal((await getJson(server.base, "/api/does-not-exist")).status, 404);
  assert.equal((await getJson(server.base, "/api/workbooks/unknown-id")).status, 404);
  assert.equal((await fetch(`${server.base}/favicon.ico`)).status, 404);
  assert.equal((await fetch(`${server.base}/deep/link`)).status, 404);
  assert.equal((await getJson(server.base, "/health")).status, 200);
});
