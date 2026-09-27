import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

async function withServer(t, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-server-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const prev = process.env.SHALLOW_DATA_DIR;
  process.env.SHALLOW_DATA_DIR = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.SHALLOW_DATA_DIR;
    else process.env.SHALLOW_DATA_DIR = prev;
  });
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fn(base);
}

async function getJson(base, pathname) {
  const res = await fetch(`${base}${pathname}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function sendJson(base, pathname, method, payload) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

test("health endpoints respond on /health and /api/health", async (t) => {
  await withServer(t, async (base) => {
    for (const p of ["/health", "/api/health"]) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: "ok" });
    }
  });
});

test("workbook list contains the seeded Q3 Sales record", async (t) => {
  await withServer(t, async (base) => {
    const { status, body } = await getJson(base, "/api/workbooks");
    assert.equal(status, 200);
    assert.equal(body.workbooks.length, 1);
    assert.equal(body.workbooks[0].name, "Q3 Sales");
    assert.ok(body.workbooks[0].updatedAt);
  });
});

test("GET workbook by id returns full workbook with Sheet1+Sheet2 and the seeded rows", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { status, body: wb } = await getJson(base, `/api/workbooks/${id}`);
    assert.equal(status, 200);
    assert.equal(wb.workbook.name, "Q3 Sales");
    assert.equal(wb.workbook.sheets.length, 2);
    assert.equal(wb.workbook.sheets[0].name, "Sheet1");
    assert.deepEqual(wb.workbook.sheets[0].cells, {
      A1: "Item",
      B1: "Qty",
      A2: "Pen",
      B2: "4",
    });
    assert.deepEqual(wb.workbook.sheets[0].selection, { current: "A1", end: "A1" });
    assert.equal(wb.workbook.sheets[1].name, "Sheet2");
  });
});

test("unknown workbook id returns 404", async (t) => {
  await withServer(t, async (base) => {
    const { status } = await getJson(base, "/api/workbooks/does-not-exist");
    assert.equal(status, 404);
  });
});

test("POST creates a blank workbook that then appears in the list", async (t) => {
  await withServer(t, async (base) => {
    const created = await sendJson(base, "/api/workbooks", "POST", { name: "  My Book  " });
    assert.equal(created.status, 201);
    assert.equal(created.body.workbook.name, "My Book");
    assert.equal(created.body.workbook.sheets[0].name, "Sheet1");
    const { body } = await getJson(base, "/api/workbooks");
    assert.equal(body.workbooks.length, 2);
    assert.ok(body.workbooks.some((w) => w.name === "My Book"));
  });
});

test("PATCH renames a workbook; empty name is rejected with 400 and the message", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const ok = await sendJson(base, `/api/workbooks/${id}`, "PATCH", { name: "  Renamed Book  " });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.workbook.name, "Renamed Book");
    const bad = await sendJson(base, `/api/workbooks/${id}`, "PATCH", { name: "   " });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.message, "Workbook name cannot be empty");
    const after = await getJson(base, `/api/workbooks/${id}`);
    assert.equal(after.body.workbook.name, "Renamed Book");
  });
});

test("PATCH on unknown workbook returns 404", async (t) => {
  await withServer(t, async (base) => {
    const res = await sendJson(base, "/api/workbooks/nope", "PATCH", { name: "X" });
    assert.equal(res.status, 404);
  });
});

test("POST sheets adds a blank active worksheet with the first unused SheetN name", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const res = await sendJson(base, `/api/workbooks/${id}/sheets`, "POST", {});
    assert.equal(res.status, 201);
    const wb = res.body.workbook;
    assert.equal(wb.sheets.length, 3);
    const added = wb.sheets[2];
    assert.equal(added.name, "Sheet3");
    assert.deepEqual(added.cells, {});
    assert.equal(added.activeCell, "A1");
    assert.equal(wb.activeSheetId, added.id);
    // existing sheets unchanged and persisted
    const reopened = await getJson(base, `/api/workbooks/${id}`);
    assert.equal(reopened.body.workbook.sheets.length, 3);
    assert.equal(reopened.body.workbook.sheets[2].name, "Sheet3");
    assert.deepEqual(reopened.body.workbook.sheets[0].cells, {
      A1: "Item",
      B1: "Qty",
      A2: "Pen",
      B2: "4",
    });
  });
});

test("POST sheets on an unknown workbook returns 404", async (t) => {
  await withServer(t, async (base) => {
    const res = await sendJson(base, "/api/workbooks/nope/sheets", "POST", {});
    assert.equal(res.status, 404);
  });
});

test("PATCH sheet renames a worksheet; empty and duplicate names are rejected with 400", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[1].id;
    assert.equal(wbBody.workbook.sheets[1].name, "Sheet2");

    const ok = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}`, "PATCH", {
      name: "  Data  ",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.workbook.sheets[1].name, "Data");

    const empty = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}`, "PATCH", {
      name: "   ",
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.message, "Worksheet name cannot be empty");

    const dup = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}`, "PATCH", {
      name: "Sheet1",
    });
    assert.equal(dup.status, 400);
    assert.equal(dup.body.error.message, "Worksheet name already exists");

    const after = await getJson(base, `/api/workbooks/${id}`);
    assert.equal(after.body.workbook.sheets[1].name, "Data");
    assert.equal(after.body.workbook.sheets[0].name, "Sheet1");
  });
});

test("PATCH sheet with unknown workbook or sheet returns 404", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const missingWb = await sendJson(base, `/api/workbooks/nope/sheets/xyz`, "PATCH", { name: "X" });
    assert.equal(missingWb.status, 404);
    const missingSheet = await sendJson(base, `/api/workbooks/${id}/sheets/xyz`, "PATCH", { name: "X" });
    assert.equal(missingSheet.status, 404);
  });
});

test("POST rows inserts a blank row above the target and persists the shifted grid", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;

    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/rows`, "POST", {
      action: "insert-above",
      row: 2,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      A1: "Item",
      B1: "Qty",
      A3: "Pen",
      B3: "4",
    });
    // other sheets unchanged and the shift survives reopening
    assert.deepEqual(res.body.workbook.sheets[1].cells, {});
    const reopened = await getJson(base, `/api/workbooks/${id}`);
    assert.deepEqual(reopened.body.workbook.sheets[0].cells, res.body.workbook.sheets[0].cells);
  });
});

test("POST rows deletes the target row and shifts later rows up", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;

    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/rows`, "POST", {
      action: "delete",
      row: 2,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      A1: "Item",
      B1: "Qty",
    });
  });
});

test("POST rows rejects invalid actions and rows with 400 and leaves the grid unchanged", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;
    const before = await getJson(base, `/api/workbooks/${id}`);

    for (const payload of [
      { action: "bogus", row: 1 },
      { action: "insert-above", row: 0 },
      { action: "insert-above", row: "x" },
    ]) {
      const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/rows`, "POST", payload);
      assert.equal(res.status, 400);
    }
    const after = await getJson(base, `/api/workbooks/${id}`);
    assert.deepEqual(after.body.workbook.sheets[0].cells, before.body.workbook.sheets[0].cells);
  });
});

test("POST columns inserts a blank column left of the target and persists the shifted grid", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;

    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/columns`, "POST", {
      action: "insert-left",
      column: 2,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      A1: "Item",
      C1: "Qty",
      A2: "Pen",
      C2: "4",
    });
    // other sheets unchanged and the shift survives reopening
    assert.deepEqual(res.body.workbook.sheets[1].cells, {});
    const reopened = await getJson(base, `/api/workbooks/${id}`);
    assert.deepEqual(reopened.body.workbook.sheets[0].cells, res.body.workbook.sheets[0].cells);
  });
});

test("POST columns deletes the target column and shifts later columns left", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;

    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/columns`, "POST", {
      action: "delete",
      column: 2,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      A1: "Item",
      A2: "Pen",
    });
  });
});

test("POST columns rejects invalid actions and columns with 400 and leaves the grid unchanged", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;
    const before = await getJson(base, `/api/workbooks/${id}`);

    for (const payload of [
      { action: "bogus", column: 1 },
      { action: "insert-left", column: 0 },
      { action: "insert-left", column: "x" },
    ]) {
      const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/columns`, "POST", payload);
      assert.equal(res.status, 400);
    }
    const after = await getJson(base, `/api/workbooks/${id}`);
    assert.deepEqual(after.body.workbook.sheets[0].cells, before.body.workbook.sheets[0].cells);
  });
});

test("POST columns on unknown workbook or sheet returns 404", async (t) => {
  await withServer(t, async (base) => {
    const missingWb = await sendJson(base, "/api/workbooks/nope/sheets/xyz/columns", "POST", {
      action: "insert-left",
      column: 1,
    });
    assert.equal(missingWb.status, 404);
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const missingSheet = await sendJson(base, `/api/workbooks/${id}/sheets/xyz/columns`, "POST", {
      action: "insert-left",
      column: 1,
    });
    assert.equal(missingSheet.status, 404);
  });
});

test("POST rows on unknown workbook or sheet returns 404", async (t) => {
  await withServer(t, async (base) => {
    const missingWb = await sendJson(base, "/api/workbooks/nope/sheets/xyz/rows", "POST", {
      action: "insert-above",
      row: 1,
    });
    assert.equal(missingWb.status, 404);
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const missingSheet = await sendJson(base, `/api/workbooks/${id}/sheets/xyz/rows`, "POST", {
      action: "insert-above",
      row: 1,
    });
    assert.equal(missingSheet.status, 404);
  });
});

test("PATCH cells/:coord sets a cell value, marks it selected, and persists after reopen", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;

    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/cells/D1`, "PATCH", {
      value: "East",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.workbook.sheets[0].cells.D1, "East");
    assert.equal(res.body.workbook.sheets[0].activeCell, "D1");
    assert.deepEqual(res.body.workbook.sheets[0].selection, { current: "D1", end: "D1" });
    const reopened = await getJson(base, `/api/workbooks/${id}`);
    assert.equal(reopened.body.workbook.sheets[0].cells.D1, "East");
    assert.deepEqual(reopened.body.workbook.sheets[0].selection, { current: "D1", end: "D1" });
  });
});

test("PATCH cells/:coord clears a cell with an empty value and rejects bad input with 400", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;

    const ok = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/cells/A1`, "PATCH", {
      value: "",
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.workbook.sheets[0].cells.A1, undefined);
    const badCoord = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/cells/1A`, "PATCH", {
      value: "x",
    });
    assert.equal(badCoord.status, 400);
    assert.equal(badCoord.body.error.message, "Invalid cell coordinate");
    const badValue = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/cells/A1`, "PATCH", {
      value: 42,
    });
    assert.equal(badValue.status, 400);
    const missingSheet = await sendJson(base, `/api/workbooks/${id}/sheets/nope/cells/A1`, "PATCH", {
      value: "x",
    });
    assert.equal(missingSheet.status, 404);
  });
});

test("PATCH selection persists the rectangle without touching updatedAt", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const { body: wbBody } = await getJson(base, `/api/workbooks/${id}`);
    const sheetId = wbBody.workbook.sheets[0].id;
    const before = wbBody.workbook.updatedAt;

    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/selection`, "PATCH", {
      current: "A1",
      end: "C3",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].selection, { current: "A1", end: "C3" });
    assert.equal(res.body.workbook.sheets[0].activeCell, "A1");
    assert.equal(res.body.workbook.updatedAt, before);
    const bad = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/selection`, "PATCH", {
      current: "A1",
      end: "nope",
    });
    assert.equal(bad.status, 400);
    const reopened = await getJson(base, `/api/workbooks/${id}`);
    assert.deepEqual(reopened.body.workbook.sheets[0].selection, { current: "A1", end: "C3" });
  });
});

test("unknown API paths and non-existent static files return 404 without crashing", async (t) => {
  await withServer(t, async (base) => {
    const api = await fetch(`${base}/api/unknown`);
    assert.equal(api.status, 404);
    const favicon = await fetch(`${base}/favicon.ico`);
    assert.equal(favicon.status, 404);
    const staticMissing = await fetch(`${base}/assets/not-here.js`);
    assert.equal(staticMissing.status, 404);
    // server still healthy afterwards
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
  });
});

test("root serves the frontend build when dist exists", async (t) => {
  await withServer(t, async (base) => {
    const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "frontend", "dist");
    const index = path.join(dist, "index.html");
    try {
      await fs.access(index);
    } catch {
      return; // dist not built in this environment; covered by browser check
    }
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /<div id="root"><\/div>/);
  });
});

test("POST /api/import-csv creates a workbook named after the file and opens Sheet1 with the full CSV", async (t) => {
  await withServer(t, async (base) => {
    const csv = 'Region,East,1200\nNorth,800,West\n地区,华东,"a,b"';
    const res = await fetch(`${base}/api/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "sales data.csv", csv }),
    });
    assert.equal(res.status, 201);
    const { workbook } = await res.json();
    assert.equal(workbook.name, "sales data");
    assert.equal(workbook.sheets.length, 1);
    const sheet = workbook.sheets[0];
    assert.equal(sheet.name, "Sheet1");
    assert.equal(sheet.activeCell, "A1");
    assert.equal(sheet.rowCount, 3);
    assert.equal(sheet.columnCount, 3);
    assert.deepEqual(sheet.cells, {
      A1: "Region",
      B1: "East",
      C1: "1200",
      A2: "North",
      B2: "800",
      C2: "West",
      A3: "地区",
      B3: "华东",
      C3: "a,b",
    });

    // The imported workbook is persisted and listed on the home page data.
    const { body: list } = await getJson(base, "/api/workbooks");
    assert.ok(list.workbooks.some((w) => w.name === "sales data"));
    const { status: reopened, body: reopenedBody } = await getJson(base, `/api/workbooks/${workbook.id}`);
    assert.equal(reopened, 200);
    assert.deepEqual(reopenedBody.workbook.sheets[0].cells, sheet.cells);
  });
});

test("POST /api/import-csv preserves empty fields and escapes nothing on the way in", async (t) => {
  await withServer(t, async (base) => {
    const res = await fetch(`${base}/api/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "blanks.csv", csv: 'a,,c,\n"x""y",,z' }),
    });
    assert.equal(res.status, 201);
    const { workbook } = await res.json();
    const sheet = workbook.sheets[0];
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.columnCount, 4);
    assert.deepEqual(sheet.cells, { A1: "a", C1: "c", A2: 'x"y', C2: "z" });
  });
});

test("POST /api/import-csv rejects invalid CSV without creating any record", async (t) => {
  await withServer(t, async (base) => {
    const before = await getJson(base, "/api/workbooks");
    const res = await fetch(`${base}/api/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "broken.csv", csv: 'Region,"East\nNorth,1200' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.message, "Invalid CSV file format. Import failed.");

    const after = await getJson(base, "/api/workbooks");
    assert.equal(after.body.workbooks.length, before.body.workbooks.length);
    assert.ok(!after.body.workbooks.some((w) => w.name === "broken"));
  });
});

test("POST /api/import-csv rejects a malformed body without creating a record", async (t) => {
  await withServer(t, async (base) => {
    const before = await getJson(base, "/api/workbooks");
    const res = await fetch(`${base}/api/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: 42 }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.message, "Invalid CSV file format. Import failed.");
    const after = await getJson(base, "/api/workbooks");
    assert.equal(after.body.workbooks.length, before.body.workbooks.length);
  });
});

test("unknown API paths still return 404 after the import route is added", async (t) => {
  await withServer(t, async (base) => {
    const res = await fetch(`${base}/api/import-csv`, { method: "GET" });
    assert.equal(res.status, 404);
  });
});
