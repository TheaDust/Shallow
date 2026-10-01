import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET1 = "wb-q3-sales-sheet-1";
const SHEET2 = "wb-q3-sales-sheet-2";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-selection-"));
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

function patchSheet(baseUrl, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function openWorkbook(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

test("persists the complete rectangle of the last successful selection", async () => {
  const api = await startApi();
  try {
    const selected = await patchSheet(api.baseUrl, SHEET1, {
      selection: { start: "d1", end: "e2" },
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(sheetOf(selected.body.workbook, SHEET1).selection, {
      start: "D1",
      end: "E2",
    });

    const reopened = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(reopened.body.workbook, SHEET1).selection, { start: "D1", end: "E2" });

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).selection, { start: "D1", end: "E2" });
  } finally {
    await api.close();
  }
});

test("keeps one selection per worksheet and lets a new selection replace it", async () => {
  const api = await startApi();
  try {
    await patchSheet(api.baseUrl, SHEET1, { selection: { start: "D1", end: "E2" } });
    await patchSheet(api.baseUrl, SHEET2, { selection: { start: "B3", end: "C4" } });
    const replaced = await patchSheet(api.baseUrl, SHEET1, { selection: { start: "A1", end: "A1" } });
    assert.equal(replaced.status, 200);

    const workbook = (await openWorkbook(api.baseUrl)).body.workbook;
    assert.deepEqual(sheetOf(workbook, SHEET1).selection, { start: "A1", end: "A1" });
    assert.deepEqual(sheetOf(workbook, SHEET2).selection, { start: "B3", end: "C4" });
  } finally {
    await api.close();
  }
});

test("selection saves leave the last-updated value alone and reject an invalid rectangle", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const saved = await patchSheet(api.baseUrl, SHEET1, {
      selection: { start: "D1", end: "E2" },
    });
    assert.equal(saved.body.workbook.updatedAt, before.body.workbook.updatedAt);

    for (const selection of [null, {}, { start: "A1" }, { start: "1A", end: "B2" }, "A1:B2"]) {
      const rejected = await patchSheet(api.baseUrl, SHEET1, { selection });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Invalid cell selection");
    }

    const unchanged = await openWorkbook(api.baseUrl);
    assert.deepEqual(sheetOf(unchanged.body.workbook, SHEET1).selection, { start: "D1", end: "E2" });
    assert.equal(unchanged.body.workbook.updatedAt, before.body.workbook.updatedAt);
  } finally {
    await api.close();
  }
});

test("still rejects a patch that changes no supported field", async () => {
  const api = await startApi();
  try {
    const empty = await patchSheet(api.baseUrl, SHEET1, {});
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "No supported fields to update");

    const renamed = await patchSheet(api.baseUrl, SHEET1, { name: "Sheet1" });
    assert.equal(renamed.status, 200);
    assert.equal(sheetOf(renamed.body.workbook, SHEET1).name, "Sheet1");
  } finally {
    await api.close();
  }
});
