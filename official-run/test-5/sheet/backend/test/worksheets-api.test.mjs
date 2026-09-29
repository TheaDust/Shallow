import test from "node:test";
import assert from "node:assert/strict";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";

function worksheetPath(collection) {
  return `${WORKBOOK}/worksheets`;
}

test("adding a worksheet uses the first unused SheetN name and activates it", async () => {
  const app = await startApp();
  try {
    const created = await request(app.baseUrl, worksheetPath(), { method: "POST", body: "{}" });
    assert.equal(created.status, 201);
    const workbook = created.body.workbook;
    assert.equal(workbook.worksheets.length, 3);
    const added = workbook.worksheets[2];
    assert.equal(added.name, "Sheet3");
    assert.deepEqual(added.cells, {});
    assert.equal(added.activeCell, "A1");
    assert.equal(workbook.activeWorksheetId, added.id);
    assert.equal(workbook.worksheets[0].name, "Sheet1");
    assert.equal(workbook.worksheets[0].cells.A2, "East");
    assert.equal(workbook.worksheets[1].name, "Sheet2");

    const reopened = await request(app.baseUrl, WORKBOOK);
    assert.equal(reopened.body.workbook.worksheets.length, 3);
    assert.equal(reopened.body.workbook.worksheets[2].name, "Sheet3");

    const restarted = createJsonStore(app.storePath, createSeedState());
    const persisted = await restarted.read();
    assert.equal(persisted.workbooks[0].worksheets.length, 3);
  } finally {
    await app.close();
  }
});

test("a freed SheetN name is reused, otherwise the counter keeps growing", async () => {
  const app = await startApp();
  try {
    // Sheet2 is renamed away, so the next added worksheet takes that free name.
    const renamed = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet2`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Notes" }),
    });
    assert.equal(renamed.status, 200);

    const created = await request(app.baseUrl, worksheetPath(), { method: "POST", body: "{}" });
    const names = created.body.workbook.worksheets.map((sheet) => sheet.name);
    assert.deepEqual(names, ["Sheet1", "Notes", "Sheet2"]);

    const again = await request(app.baseUrl, worksheetPath(), { method: "POST", body: "{}" });
    assert.deepEqual(again.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Notes", "Sheet2", "Sheet3"]);
  } finally {
    await app.close();
  }
});

test("adding a worksheet to an unknown workbook fails without creating anything", async () => {
  const app = await startApp();
  try {
    const failed = await request(app.baseUrl, "/api/workbooks/nope/worksheets", { method: "POST", body: "{}" });
    assert.equal(failed.status, 404);
    assert.equal(failed.body.error, "Workbook not found");
  } finally {
    await app.close();
  }
});

test("renaming a worksheet trims the name and keeps the other worksheets untouched", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, WORKBOOK);
    const renamed = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet1`, {
      method: "PATCH",
      body: JSON.stringify({ name: "  Regional sales  " }),
    });
    assert.equal(renamed.status, 200);
    const sheets = renamed.body.workbook.worksheets;
    assert.equal(sheets[0].name, "Regional sales");
    assert.equal(sheets[0].id, "ws-q3-sheet1");
    assert.deepEqual(sheets[0].cells, before.body.workbook.worksheets[0].cells);
    assert.equal(sheets[1].name, "Sheet2");
    assert.equal(renamed.body.workbook.activeWorksheetId, before.body.workbook.activeWorksheetId);

    const reopened = await request(app.baseUrl, WORKBOOK);
    assert.equal(reopened.body.workbook.worksheets[0].name, "Regional sales");

    const restarted = createJsonStore(app.storePath, createSeedState());
    const persisted = await restarted.read();
    assert.equal(persisted.workbooks[0].worksheets[0].name, "Regional sales");
  } finally {
    await app.close();
  }
});

test("empty worksheet names are rejected with the documented message", async () => {
  const app = await startApp();
  try {
    for (const name of ["", "   ", "\t\n "]) {
      const rejected = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet1`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Worksheet name cannot be empty");
    }
    const opened = await request(app.baseUrl, WORKBOOK);
    assert.equal(opened.body.workbook.worksheets[0].name, "Sheet1");
  } finally {
    await app.close();
  }
});

test("duplicate worksheet names inside one workbook are rejected", async () => {
  const app = await startApp();
  try {
    const rejected = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet1`, {
      method: "PATCH",
      body: JSON.stringify({ name: " Sheet2 " }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Worksheet name already exists");

    const opened = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(opened.body.workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2"]);

    // The same name in another workbook is fine.
    const other = await request(app.baseUrl, "/api/workbooks", {
      method: "POST",
      body: JSON.stringify({ name: "Other" }),
    });
    const otherSheet = other.body.workbook.worksheets[0];
    const allowed = await request(
      app.baseUrl,
      `/api/workbooks/${other.body.workbook.id}/worksheets/${otherSheet.id}`,
      { method: "PATCH", body: JSON.stringify({ name: "Sheet2" }) },
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.workbook.worksheets[0].name, "Sheet2");

    // Renaming a worksheet to its own (trimmed) name is not a duplicate.
    const noop = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet2`, {
      method: "PATCH",
      body: JSON.stringify({ name: " Sheet2 " }),
    });
    assert.equal(noop.status, 200);
    assert.equal(noop.body.workbook.worksheets[1].name, "Sheet2");
  } finally {
    await app.close();
  }
});

test("renaming an unknown worksheet answers 404 and leaves the workbook untouched", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, WORKBOOK);
    const missing = await request(app.baseUrl, `${WORKBOOK}/worksheets/nope`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Whatever" }),
    });
    assert.equal(missing.status, 404);
    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await app.close();
  }
});

test("a selection-only patch still works and an empty worksheet patch is rejected", async () => {
  const app = await startApp();
  try {
    const selected = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet1`, {
      method: "PATCH",
      body: JSON.stringify({ activeCell: "B2" }),
    });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.workbook.worksheets[0].activeCell, "B2");
    assert.equal(selected.body.workbook.worksheets[0].name, "Sheet1");

    const empty = await request(app.baseUrl, `${WORKBOOK}/worksheets/ws-q3-sheet1`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    assert.equal(empty.status, 400);
  } finally {
    await app.close();
  }
});
