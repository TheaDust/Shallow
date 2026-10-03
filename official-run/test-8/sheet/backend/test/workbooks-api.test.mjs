import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-workbooks-"));
  const { handler } = createApp({ dataDir });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    dataDir,
    base,
    async call(path, init) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { status: response.status, body };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("seeds the shared Q3 Sales workbook into empty storage", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const list = await app.call("/api/workbooks");
  assert.equal(list.status, 200);
  assert.equal(list.body.workbooks.length, 1);
  assert.equal(list.body.workbooks[0].name, "Q3 Sales");
  assert.ok(list.body.workbooks[0].updatedAt);

  const detail = await app.call("/api/workbooks/workbook-q3-sales");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.workbook.name, "Q3 Sales");
  assert.deepEqual(
    detail.body.workbook.worksheets.map((entry) => entry.name),
    ["Sheet1", "Sheet2"],
  );
  assert.equal(detail.body.workbook.worksheets[0].cells.A1, "Region");
  assert.equal(detail.body.workbook.worksheets[0].cells.A2, "East");
  assert.equal(detail.body.workbook.worksheets[0].cells.B2, "1200");
  assert.deepEqual(detail.body.workbook.worksheets[1].cells, {});
  assert.equal(detail.body.workbook.activeWorksheetId, detail.body.workbook.worksheets[0].id);
});

test("creates a blank workbook with Sheet1 active and A1 selected", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const created = await app.call("/api/workbooks", { method: "POST", body: JSON.stringify({}) });
  assert.equal(created.status, 201);
  const workbook = created.body.workbook;
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].name, "Sheet1");
  assert.deepEqual(workbook.worksheets[0].cells, {});
  assert.deepEqual(workbook.worksheets[0].selection, {
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  });
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);

  const list = await app.call("/api/workbooks");
  assert.equal(list.body.workbooks.length, 2);
  assert.ok(list.body.workbooks.some((entry) => entry.id === workbook.id));

  const reloaded = await app.call(`/api/workbooks/${workbook.id}`);
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.workbook.name, workbook.name);
});

test("rejects an empty created workbook name without adding a record", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const created = await app.call("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name: "   " }),
  });
  assert.equal(created.status, 422);
  assert.equal(created.body.error, "Workbook name cannot be empty");

  const list = await app.call("/api/workbooks");
  assert.equal(list.body.workbooks.length, 1);
});

test("renames a workbook by trimming the name and persists it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const renamed = await app.call("/api/workbooks/workbook-q3-sales", {
    method: "PATCH",
    body: JSON.stringify({ name: "  Q3 Sales Final  " }),
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.workbook.name, "Q3 Sales Final");

  const list = await app.call("/api/workbooks");
  assert.equal(list.body.workbooks[0].name, "Q3 Sales Final");
});

test("rejects an empty rename and keeps the stored name", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const rejected = await app.call("/api/workbooks/workbook-q3-sales", {
    method: "PATCH",
    body: JSON.stringify({ name: "   " }),
  });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error, "Workbook name cannot be empty");

  const detail = await app.call("/api/workbooks/workbook-q3-sales");
  assert.equal(detail.body.workbook.name, "Q3 Sales");
});

test("persists the active worksheet and selection across store recreation", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const detail = await app.call("/api/workbooks/workbook-q3-sales");
  const worksheetId = detail.body.workbook.worksheets[0].id;
  const patched = await app.call(`/api/workbooks/workbook-q3-sales/worksheets/${worksheetId}`, {
    method: "PATCH",
    body: JSON.stringify({ selection: { anchor: { row: 2, col: 1 }, focus: { row: 0, col: 0 } } }),
  });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.worksheet.selection, {
    anchor: { row: 2, col: 1 },
    focus: { row: 0, col: 0 },
  });

  const invalid = await app.call(`/api/workbooks/workbook-q3-sales/worksheets/${worksheetId}`, {
    method: "PATCH",
    body: JSON.stringify({ selection: { anchor: { row: -1, col: 0 }, focus: { row: 0, col: 0 } } }),
  });
  assert.equal(invalid.status, 400);

  const reopened = createApp({ dataDir: app.dataDir });
  const server = createServer((request, response) => void reopened.handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/workbooks/workbook-q3-sales`);
    const body = await response.json();
    assert.deepEqual(body.workbook.worksheets[0].selection, {
      anchor: { row: 2, col: 1 },
      focus: { row: 0, col: 0 },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns 404 for unknown workbooks and unknown API paths", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  assert.equal((await app.call("/api/workbooks/missing")).status, 404);
  assert.equal((await app.call("/api/unknown")).status, 404);
  assert.equal((await app.call("/api/workbooks/missing", { method: "PATCH", body: "{}" })).status, 404);
});
