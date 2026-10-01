import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-workbooks-"));
  const store = createWorkbookStore(directory);
  const handleApi = createApiHandler({ store });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void handleApi(request, response, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  return {
    directory,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { status: response.status, body };
}

function patchJson(baseUrl, path, payload) {
  return callJson(baseUrl, path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("seeds the evaluation workbook on an empty data directory", async () => {
  const api = await startApi();
  try {
    const list = await callJson(api.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    assert.equal(list.body.workbooks.length, 1);
    assert.equal(list.body.workbooks[0].name, "Q3 Sales");

    const opened = await callJson(api.baseUrl, `/api/workbooks/${list.body.workbooks[0].id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.workbook.name, "Q3 Sales");
    assert.deepEqual(
      opened.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );
    assert.deepEqual(opened.body.workbook.sheets[0].cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "East",
      B2: "1200",
      C2: "Open",
      A3: "North",
      B3: "800",
      C3: "Closed",
      A4: "South",
      B4: "700",
      C4: "Open",
    });
    // The REQ-4 formula sample lives on the second worksheet, so Sheet1 keeps `A1=Region`.
    assert.deepEqual(opened.body.workbook.sheets[1].cells, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });
    assert.deepEqual(opened.body.workbook.sheets[1].values, {
      A1: "2",
      B1: "3",
      C1: "5",
      D1: "10",
    });
    // The data region starts with a header row, so the seed ships no filter and no hidden row.
    assert.deepEqual(opened.body.workbook.sheets[0].hiddenRows, []);
    assert.equal(opened.body.workbook.sheets[0].filter, undefined);
    assert.equal(opened.body.workbook.activeSheetId, opened.body.workbook.sheets[0].id);
  } finally {
    await api.close();
  }
});

test("creates a blank workbook that survives a store restart", async () => {
  const api = await startApi();
  try {
    const created = await callJson(api.baseUrl, "/api/workbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Budget  " }),
    });
    assert.equal(created.status, 201);
    const workbook = created.body.workbook;
    assert.equal(workbook.name, "Budget");
    assert.equal(workbook.sheets.length, 1);
    assert.equal(workbook.sheets[0].name, "Sheet1");
    assert.deepEqual(workbook.sheets[0].cells, {});
    assert.equal(workbook.activeSheetId, workbook.sheets[0].id);

    const restartedStore = createWorkbookStore(api.directory);
    const persisted = await restartedStore.read();
    assert.equal(persisted.workbooks.length, 2);
    assert.ok(persisted.workbooks.some((entry) => entry.id === workbook.id && entry.name === "Budget"));

    const list = await callJson(api.baseUrl, "/api/workbooks");
    assert.deepEqual(
      list.body.workbooks.map((entry) => entry.name).sort(),
      ["Budget", "Q3 Sales"],
    );
  } finally {
    await api.close();
  }
});

test("names a blank workbook when no name is submitted", async () => {
  const api = await startApi();
  try {
    const created = await callJson(api.baseUrl, "/api/workbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.workbook.name, "Untitled spreadsheet");
  } finally {
    await api.close();
  }
});

test("renames a workbook and rejects an empty name without changing state", async () => {
  const api = await startApi();
  try {
    const renamed = await patchJson(api.baseUrl, "/api/workbooks/wb-q3-sales", { name: "  Q3 Sales 2026  " });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "Q3 Sales 2026");

    for (const name of ["", "   ", null, 42]) {
      const rejected = await patchJson(api.baseUrl, "/api/workbooks/wb-q3-sales", { name });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Workbook name cannot be empty");
    }

    const opened = await callJson(api.baseUrl, "/api/workbooks/wb-q3-sales");
    assert.equal(opened.body.workbook.name, "Q3 Sales 2026");
    assert.equal(opened.body.workbook.sheets[0].cells.A1, "Region");
  } finally {
    await api.close();
  }
});

test("keeps the last active worksheet without touching the last updated value", async () => {
  const api = await startApi();
  try {
    const before = await callJson(api.baseUrl, "/api/workbooks/wb-q3-sales");
    const sheetId = before.body.workbook.sheets[0].id;

    const unknown = await patchJson(api.baseUrl, "/api/workbooks/wb-q3-sales", { activeSheetId: "missing" });
    assert.equal(unknown.status, 400);

    const updated = await patchJson(api.baseUrl, "/api/workbooks/wb-q3-sales", { activeSheetId: sheetId });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.workbook.activeSheetId, sheetId);
    assert.equal(updated.body.workbook.updatedAt, before.body.workbook.updatedAt);
  } finally {
    await api.close();
  }
});

test("reports missing workbooks and unknown api paths as errors", async () => {
  const api = await startApi();
  try {
    const missing = await callJson(api.baseUrl, "/api/workbooks/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "Workbook not found");

    const unknown = await callJson(api.baseUrl, "/api/unknown");
    assert.equal(unknown.status, 404);

    const missingPatch = await patchJson(api.baseUrl, "/api/workbooks/nope", { name: "X" });
    assert.equal(missingPatch.status, 404);
  } finally {
    await api.close();
  }
});
