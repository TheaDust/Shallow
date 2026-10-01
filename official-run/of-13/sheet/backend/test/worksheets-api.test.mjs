import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

const WORKBOOK = "wb-q3-sales";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-worksheets-"));
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

function jsonInit(method, payload) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function patchSheet(baseUrl, workbookId, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}/sheets/${sheetId}`, jsonInit("PATCH", payload));
}

function addSheet(baseUrl, workbookId = WORKBOOK) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}/sheets`, { method: "POST" });
}

function openWorkbook(baseUrl, workbookId = WORKBOOK) {
  return callJson(baseUrl, `/api/workbooks/${workbookId}`);
}

test("adds a blank worksheet named after the first unused SheetN and activates it", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const added = await addSheet(api.baseUrl);
    assert.equal(added.status, 201);
    assert.equal(added.body.worksheet.name, "Sheet3");
    assert.deepEqual(added.body.worksheet.cells, {});
    assert.equal(added.body.workbook.activeSheetId, added.body.worksheet.id);
    assert.deepEqual(
      added.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2", "Sheet3"],
    );
    // Existing worksheets and their data are unchanged.
    assert.deepEqual(added.body.workbook.sheets[0].cells, before.body.workbook.sheets[0].cells);
    assert.equal(added.body.workbook.sheets[0].id, before.body.workbook.sheets[0].id);
    assert.deepEqual(added.body.workbook.sheets[1].cells, before.body.workbook.sheets[1].cells);

    const persisted = await openWorkbook(api.baseUrl);
    assert.equal(persisted.body.workbook.sheets.length, 3);
    assert.equal(persisted.body.workbook.sheets[2].name, "Sheet3");
    assert.equal(persisted.body.workbook.activeSheetId, added.body.worksheet.id);

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(
      restarted.workbooks[0].sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2", "Sheet3"],
    );
  } finally {
    await api.close();
  }
});

test("reuses a SheetN name that a rename freed", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const sheet1 = before.body.workbook.sheets[0];
    const renamed = await patchSheet(api.baseUrl, WORKBOOK, sheet1.id, { name: "Report" });
    assert.equal(renamed.status, 200);

    const added = await addSheet(api.baseUrl);
    assert.equal(added.body.worksheet.name, "Sheet1");
  } finally {
    await api.close();
  }
});

test("adds worksheets to a missing workbook as an error without writing anything", async () => {
  const api = await startApi();
  try {
    const added = await addSheet(api.baseUrl, "nope");
    assert.equal(added.status, 404);
    assert.equal(added.body.error, "Workbook not found");

    const unknown = await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets`, {
      method: "PUT",
    });
    assert.equal(unknown.status, 405);
  } finally {
    await api.close();
  }
});

test("renames a worksheet by trimming the submitted name and persisting it", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const sheet1 = before.body.workbook.sheets[0];

    const renamed = await patchSheet(api.baseUrl, WORKBOOK, sheet1.id, { name: "  Q3 Revenue  " });
    assert.equal(renamed.status, 200);
    assert.deepEqual(
      renamed.body.workbook.sheets.map((sheet) => sheet.name),
      ["Q3 Revenue", "Sheet2"],
    );
    assert.deepEqual(renamed.body.workbook.sheets[0].cells, sheet1.cells);

    const persisted = await openWorkbook(api.baseUrl);
    assert.equal(persisted.body.workbook.sheets[0].name, "Q3 Revenue");
    assert.equal(persisted.body.workbook.sheets[0].cells.A2, "East");

    const restarted = await createWorkbookStore(api.directory).read();
    assert.equal(restarted.workbooks[0].sheets[0].name, "Q3 Revenue");
  } finally {
    await api.close();
  }
});

test("rejects empty and duplicate worksheet names without changing state", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const [sheet1, sheet2] = before.body.workbook.sheets;

    for (const name of ["", "   ", null, 42]) {
      const rejected = await patchSheet(api.baseUrl, WORKBOOK, sheet1.id, { name });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Worksheet name cannot be empty");
    }

    for (const name of ["Sheet2", " sheet2 ", "Sheet2\t"]) {
      const rejected = await patchSheet(api.baseUrl, WORKBOOK, sheet1.id, { name });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Worksheet name already exists");
    }

    // Renaming a worksheet to its own name (any case) stays allowed.
    const unchanged = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      unchanged.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );
    assert.equal(unchanged.body.workbook.updatedAt, before.body.workbook.updatedAt);

    const own = await patchSheet(api.baseUrl, WORKBOOK, sheet1.id, { name: " sheet1 " });
    assert.equal(own.status, 200);
    assert.equal(own.body.workbook.sheets[0].name, "sheet1");
    assert.equal(sheet2.name, "Sheet2");

    const rejectedMissing = await patchSheet(api.baseUrl, WORKBOOK, "missing-sheet", { name: "X" });
    assert.equal(rejectedMissing.status, 404);
    assert.equal(rejectedMissing.body.error, "Worksheet not found");
  } finally {
    await api.close();
  }
});

test("keeps the original worksheet name after a failed rename", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const [sheet1] = before.body.workbook.sheets;
    await patchSheet(api.baseUrl, WORKBOOK, sheet1.id, { name: "Sheet2" });

    const opened = await openWorkbook(api.baseUrl);
    assert.deepEqual(
      opened.body.workbook.sheets.map((sheet) => sheet.name),
      ["Sheet1", "Sheet2"],
    );
    assert.equal(opened.body.workbook.updatedAt, before.body.workbook.updatedAt);
  } finally {
    await api.close();
  }
});
