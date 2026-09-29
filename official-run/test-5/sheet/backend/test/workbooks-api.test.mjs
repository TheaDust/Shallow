import test from "node:test";
import assert from "node:assert/strict";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { request, requestRaw, startApp } from "./support.mjs";

test("seeded workbook is listed and can be opened directly by its entry id", async () => {
  const app = await startApp();
  try {
    const list = await request(app.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    const seeded = list.body.workbooks.find((workbook) => workbook.name === "Q3 Sales");
    assert.ok(seeded, "seeded workbook Q3 Sales is listed");
    assert.equal(typeof seeded.updatedAt, "string");

    const opened = await request(app.baseUrl, `/api/workbooks/${seeded.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.workbook.name, "Q3 Sales");
    const sheet1 = opened.body.workbook.worksheets[0];
    assert.equal(sheet1.name, "Sheet1");
    assert.equal(sheet1.cells.A1, "Region");
    assert.equal(opened.body.workbook.activeWorksheetId, sheet1.id);
    assert.equal(sheet1.activeCell, "A1");
  } finally {
    await app.close();
  }
});

test("creating a blank workbook persists a single blank Sheet1 that survives a restart", async () => {
  const app = await startApp();
  try {
    const created = await request(app.baseUrl, "/api/workbooks", {
      method: "POST",
      body: JSON.stringify({ name: "Budget" }),
    });
    assert.equal(created.status, 201);
    const workbook = created.body.workbook;
    assert.equal(workbook.name, "Budget");
    assert.equal(workbook.worksheets.length, 1);
    assert.equal(workbook.worksheets[0].name, "Sheet1");
    assert.deepEqual(workbook.worksheets[0].cells, {});
    assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
    assert.equal(workbook.worksheets[0].activeCell, "A1");

    const reopened = await request(app.baseUrl, `/api/workbooks/${workbook.id}`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.workbook.name, "Budget");

    const list = await request(app.baseUrl, "/api/workbooks");
    assert.ok(list.body.workbooks.some((entry) => entry.id === workbook.id));

    const restarted = createJsonStore(app.storePath, createSeedState());
    const persisted = await restarted.read();
    assert.ok(persisted.workbooks.some((entry) => entry.id === workbook.id && entry.name === "Budget"));
  } finally {
    await app.close();
  }
});

test("an unnamed blank workbook falls back to the default name and no partial record is left on failure", async () => {
  const app = await startApp();
  try {
    const created = await request(app.baseUrl, "/api/workbooks", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.workbook.name, "Untitled workbook");

    const before = await request(app.baseUrl, "/api/workbooks");
    const rejected = await request(app.baseUrl, "/api/workbooks", {
      method: "POST",
      body: JSON.stringify({ name: "x".repeat(201) }),
    });
    assert.equal(rejected.status, 400);
    const after = await request(app.baseUrl, "/api/workbooks");
    assert.equal(after.body.workbooks.length, before.body.workbooks.length);
  } finally {
    await app.close();
  }
});

test("importing CSV creates a workbook named after the file with the complete grid", async () => {
  const app = await startApp();
  try {
    const csv = 'Region,Note\n"East, North","say ""hi"""\n华东,"line1\nline2"\nSouth,';
    const imported = await request(app.baseUrl, "/api/workbooks/import", {
      method: "POST",
      body: JSON.stringify({ fileName: "Q4 Pipeline.csv", content: csv }),
    });
    assert.equal(imported.status, 201);
    const workbook = imported.body.workbook;
    assert.equal(workbook.name, "Q4 Pipeline");
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.name, "Sheet1");
    assert.deepEqual(sheet.cells, {
      A1: "Region",
      B1: "Note",
      A2: "East, North",
      B2: 'say "hi"',
      A3: "华东",
      B3: "line1\nline2",
      A4: "South",
    });

    const reopened = await request(app.baseUrl, `/api/workbooks/${workbook.id}`);
    assert.deepEqual(reopened.body.workbook.worksheets[0].cells, sheet.cells);
  } finally {
    await app.close();
  }
});

test("invalid CSV is rejected with the documented message and leaves no workbook behind", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "/api/workbooks");
    const failed = await request(app.baseUrl, "/api/workbooks/import", {
      method: "POST",
      body: JSON.stringify({ fileName: "broken.csv", content: 'a,"unterminated\nb,2' }),
    });
    assert.equal(failed.status, 400);
    assert.equal(failed.body.error, "Invalid CSV file format. Import failed.");

    const after = await request(app.baseUrl, "/api/workbooks");
    assert.equal(after.body.workbooks.length, before.body.workbooks.length);
    assert.ok(!after.body.workbooks.some((workbook) => workbook.name === "broken"));
  } finally {
    await app.close();
  }
});

test("active worksheet and active cell selections are persisted per worksheet", async () => {
  const app = await startApp();
  try {
    const opened = await request(app.baseUrl, "/api/workbooks/wb-q3-sales");
    const [sheet1, sheet2] = opened.body.workbook.worksheets;

    const switched = await request(app.baseUrl, "/api/workbooks/wb-q3-sales", {
      method: "PATCH",
      body: JSON.stringify({ activeWorksheetId: sheet2.id }),
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.workbook.activeWorksheetId, sheet2.id);
    assert.equal(switched.body.workbook.updatedAt, opened.body.workbook.updatedAt);

    const selected = await request(
      app.baseUrl,
      `/api/workbooks/wb-q3-sales/worksheets/${sheet1.id}`,
      { method: "PATCH", body: JSON.stringify({ activeCell: "b2" }) },
    );
    assert.equal(selected.status, 200);
    const reopened = await request(app.baseUrl, "/api/workbooks/wb-q3-sales");
    assert.equal(reopened.body.workbook.activeWorksheetId, sheet2.id);
    assert.equal(reopened.body.workbook.worksheets[0].activeCell, "B2");

    const invalid = await request(
      app.baseUrl,
      `/api/workbooks/wb-q3-sales/worksheets/${sheet1.id}`,
      { method: "PATCH", body: JSON.stringify({ activeCell: "not-a-cell" }) },
    );
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
  }
});

test("renaming a workbook trims the name, keeps its sheets and survives a reopen", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "/api/workbooks/wb-q3-sales");
    const renamed = await request(app.baseUrl, "/api/workbooks/wb-q3-sales", {
      method: "PATCH",
      body: JSON.stringify({ name: "  Q3 Sales 2026  " }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "Q3 Sales 2026");
    assert.equal(renamed.body.workbook.worksheets.length, before.body.workbook.worksheets.length);
    assert.equal(renamed.body.workbook.worksheets[0].cells.A1, "Region");
    assert.equal(renamed.body.workbook.activeWorksheetId, before.body.workbook.activeWorksheetId);

    const list = await request(app.baseUrl, "/api/workbooks");
    const seeded = list.body.workbooks.find((entry) => entry.id === "wb-q3-sales");
    assert.equal(seeded.name, "Q3 Sales 2026");

    const restarted = createJsonStore(app.storePath, createSeedState());
    const persisted = await restarted.read();
    assert.equal(persisted.workbooks[0].name, "Q3 Sales 2026");
  } finally {
    await app.close();
  }
});

test("an empty or whitespace-only rename is rejected and leaves the previous name untouched", async () => {
  const app = await startApp();
  try {
    for (const name of ["", "   ", "\t\n "]) {
      const rejected = await request(app.baseUrl, "/api/workbooks/wb-q3-sales", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Workbook name cannot be empty");
    }

    const opened = await request(app.baseUrl, "/api/workbooks/wb-q3-sales");
    assert.equal(opened.body.workbook.name, "Q3 Sales");
    assert.equal(opened.body.workbook.updatedAt, "2026-09-15T08:30:00.000Z");

    const missing = await request(app.baseUrl, "/api/workbooks/nope", {
      method: "PATCH",
      body: JSON.stringify({ name: "Whatever" }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test("exporting the active worksheet downloads its used range as CSV without touching the workbook", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, "/api/workbooks/wb-q3-sales");
    const exported = await requestRaw(app.baseUrl, "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet1/export");

    assert.equal(exported.status, 200);
    assert.match(exported.contentType ?? "", /^text\/csv/);
    assert.match(exported.disposition ?? "", /attachment/);
    assert.match(exported.disposition ?? "", /\.csv/);
    assert.equal(exported.text, "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open");

    const after = await request(app.baseUrl, "/api/workbooks/wb-q3-sales");
    assert.deepEqual(after.body.workbook, before.body.workbook);

    const emptySheet = await requestRaw(app.baseUrl, "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet2/export");
    assert.equal(emptySheet.status, 200);
    assert.equal(emptySheet.text, "");

    const missingWorkbook = await requestRaw(app.baseUrl, "/api/workbooks/nope/worksheets/ws/export");
    assert.equal(missingWorkbook.status, 404);
    const missingSheet = await requestRaw(app.baseUrl, "/api/workbooks/wb-q3-sales/worksheets/nope/export");
    assert.equal(missingSheet.status, 404);
  } finally {
    await app.close();
  }
});

test("an imported worksheet exports the same rows, columns and escaping it was imported with", async () => {
  const app = await startApp();
  try {
    const csv = 'Region,Note\n"East, North","say ""hi"""\n华东,"line1\nline2"\nSouth,';
    const imported = await request(app.baseUrl, "/api/workbooks/import", {
      method: "POST",
      body: JSON.stringify({ fileName: "Q4 Pipeline.csv", content: csv }),
    });
    const workbook = imported.body.workbook;
    const sheet = workbook.worksheets[0];

    const exported = await requestRaw(
      app.baseUrl,
      `/api/workbooks/${workbook.id}/worksheets/${sheet.id}/export`,
    );
    assert.equal(exported.status, 200);
    assert.equal(
      exported.text,
      'Region,Note\n"East, North","say ""hi"""\n华东,"line1\nline2"\nSouth,',
    );
    assert.equal(exported.disposition?.includes("Q4 Pipeline"), true);
  } finally {
    await app.close();
  }
});

test("unknown APIs, unknown paths and unknown workbooks answer with errors and keep the process serving", async () => {
  const app = await startApp();
  try {
    const missingWorkbook = await request(app.baseUrl, "/api/workbooks/does-not-exist");
    assert.equal(missingWorkbook.status, 404);

    const unknownApi = await request(app.baseUrl, "/api/unknown");
    assert.equal(unknownApi.status, 404);

    const unknownPath = await fetch(`${app.baseUrl}/favicon.ico`);
    assert.equal(unknownPath.status, 404);

    const health = await request(app.baseUrl, "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true });
    const apiHealth = await request(app.baseUrl, "/api/health");
    assert.equal(apiHealth.status, 200);
  } finally {
    await app.close();
  }
});
