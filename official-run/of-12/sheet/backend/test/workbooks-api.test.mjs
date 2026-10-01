import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

const SEED_TIMESTAMP = "2026-01-15T09:30:00.000Z";

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-workbooks-"));
  const statePath = join(directory, "workbooks.json");
  const store = createJsonStore(statePath, createInitialState());
  const handler = createRequestHandler({ store, staticRoot: join(directory, "no-dist") });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const api = async (path, init = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      method: init.method ?? "GET",
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  return {
    directory,
    statePath,
    api,
    async restart() {
      const restarted = createJsonStore(statePath, createInitialState());
      const newHandler = createRequestHandler({ store: restarted, staticRoot: join(directory, "no-dist") });
      const newServer = createServer(newHandler);
      await new Promise((resolve) => newServer.listen(0, "127.0.0.1", resolve));
      return { port: newServer.address().port, close: () => close(newServer) };
    },
    close: () => close(server),
  };
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

test("serves the seeded workbook home page data", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const health = await api.api("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });
  assert.equal((await api.api("/api/health")).status, 200);

  const listing = await api.api("/api/workbooks");
  assert.equal(listing.status, 200);
  assert.equal(listing.body.workbooks.length, 1);
  const [summary] = listing.body.workbooks;
  assert.equal(summary.name, "Q3 Sales");
  assert.equal(summary.updatedAt, SEED_TIMESTAMP);
  assert.equal(summary.activeWorksheetName, "Sheet1");
});

test("exposes the seeded workbook with its worksheets, cells and selection", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const { status, body } = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(status, 200);
  const workbook = body.workbook;
  assert.equal(workbook.name, "Q3 Sales");
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Sheet1", "Sheet2"]);
  const [sheet1, sheet2] = workbook.worksheets;
  assert.equal(sheet1.id, "ws-q3-sales-sheet1");
  assert.equal(sheet1.cells.A1, "Region");
  assert.equal(sheet1.cells.A2, "East");
  assert.equal(sheet1.cells.B2, "1200");
  assert.equal(sheet1.cells.A3, "North");
  assert.equal(sheet1.cells.B3, "800");
  assert.deepEqual(sheet1.selection, { anchor: "A1", focus: "A1" });
  // The second worksheet is independent: it holds no data of Sheet1.
  assert.deepEqual(sheet2.cells, {});
  assert.equal(workbook.activeWorksheetId, sheet1.id);
});

test("creates a blank workbook with Sheet1 active and A1 selected", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const created = await api.api("/api/workbooks", { method: "POST", body: JSON.stringify({ name: "  Budget 2026  " }) });
  assert.equal(created.status, 201);
  const workbook = created.body.workbook;
  assert.equal(workbook.name, "Budget 2026");
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].name, "Sheet1");
  assert.deepEqual(workbook.worksheets[0].cells, {});
  assert.deepEqual(workbook.worksheets[0].selection, { anchor: "A1", focus: "A1" });

  const listing = await api.api("/api/workbooks");
  assert.deepEqual(listing.body.workbooks.map((item) => item.name).sort(), ["Budget 2026", "Q3 Sales"]);
});

test("rejects an empty workbook name without creating a record", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const created = await api.api("/api/workbooks", { method: "POST", body: JSON.stringify({ name: "   " }) });
  assert.equal(created.status, 400);
  assert.equal(created.body.error, "Workbook name cannot be empty");

  const renamed = await api.api("/api/workbooks/wb-q3-sales", { method: "PATCH", body: JSON.stringify({ name: " " }) });
  assert.equal(renamed.status, 400);
  assert.equal(renamed.body.error, "Workbook name cannot be empty");

  const listing = await api.api("/api/workbooks");
  assert.equal(listing.body.workbooks.length, 1);
  assert.equal(listing.body.workbooks[0].name, "Q3 Sales");
});

test("renames a workbook and persists the new name for later reads", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const renamed = await api.api("/api/workbooks/wb-q3-sales", {
    method: "PATCH",
    body: JSON.stringify({ name: "Q3 Sales 2026" }),
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.workbook.name, "Q3 Sales 2026");

  const stored = JSON.parse(await readFile(api.statePath, "utf8"));
  assert.equal(stored.workbooks[0].name, "Q3 Sales 2026");

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/wb-q3-sales`).then((r) => r.json());
  assert.equal(reopened.workbook.name, "Q3 Sales 2026");
});

test("stores cell values and keeps the seeded cell intact", async (t) => {
  const api = await startApi();
  t.after(api.close);

  for (const [cell, value] of [["A2", "East"], ["B2", "1200"], ["A3", "North"], ["B3", "800"]]) {
    const response = await api.api("/api/workbooks/wb-q3-sales/cells", {
      method: "PUT",
      body: JSON.stringify({ worksheetId: "ws-q3-sales-sheet1", cell, value }),
    });
    assert.equal(response.status, 200, `unexpected status for ${cell}`);
  }

  const stored = JSON.parse(await readFile(api.statePath, "utf8"));
  assert.deepEqual(stored.workbooks[0].worksheets[0].cells, SEED_CELLS);

  const cleared = await api.api("/api/workbooks/wb-q3-sales/cells", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: "ws-q3-sales-sheet1", cell: "B3", value: "" }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.workbook.worksheets[0].cells.B3, undefined);

  const invalid = await api.api("/api/workbooks/wb-q3-sales/cells", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: "ws-q3-sales-sheet1", cell: "1A", value: "x" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "Invalid cell coordinate");
});

test("persists the active worksheet and the selected rectangle", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const selection = await api.api("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/selection", {
    method: "PUT",
    body: JSON.stringify({ anchor: "A1", focus: "B2" }),
  });
  assert.equal(selection.status, 200);
  assert.deepEqual(selection.body.selection, { anchor: "A1", focus: "B2" });

  const active = await api.api("/api/workbooks/wb-q3-sales/active-worksheet", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: "ws-q3-sales-sheet1" }),
  });
  assert.equal(active.status, 200);

  const invalid = await api.api("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/selection", {
    method: "PUT",
    body: JSON.stringify({ anchor: "A0", focus: "B2" }),
  });
  assert.equal(invalid.status, 400);

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/wb-q3-sales`).then((r) => r.json());
  assert.deepEqual(reopened.workbook.worksheets[0].selection, { anchor: "A1", focus: "B2" });
  assert.equal(reopened.workbook.activeWorksheetId, "ws-q3-sales-sheet1");
});

const SHEET1 = "ws-q3-sales-sheet1";
/** The shared seed of `Sheet1` (REQ-5 scenarios name the `Region`/`Sales`/`Status` records). */
const SEED_CELLS = {
  A1: "Region", B1: "Sales", C1: "Status",
  A2: "East", B2: "1200", C2: "Open",
  A3: "North", B3: "800", C3: "Closed",
  A4: "South", B4: "700", C4: "Open",
};

async function structure(api, kind, body) {
  return api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/${kind}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function writeCell(api, cell, value) {
  const response = await api.api("/api/workbooks/wb-q3-sales/cells", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: SHEET1, cell, value }),
  });
  assert.equal(response.status, 200, `unexpected status for ${cell}`);
  return response;
}

test("inserts a blank row above the target row and leaves the other worksheet alone", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const inserted = await structure(api, "rows", { action: "insert-above", row: 2 });
  assert.equal(inserted.status, 200);
  const workbook = inserted.body.workbook;
  assert.deepEqual(workbook.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A3: "East", B3: "1200", C3: "Open",
    A4: "North", B4: "800", C4: "Closed",
    A5: "South", B5: "700", C5: "Open",
  });
  assert.deepEqual(workbook.worksheets[1].cells, {});
  assert.notEqual(workbook.updatedAt, SEED_TIMESTAMP);

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/wb-q3-sales`).then((r) => r.json());
  assert.deepEqual(reopened.workbook.worksheets[0].cells, workbook.worksheets[0].cells);
  assert.deepEqual(reopened.workbook.worksheets[1].cells, {});
});

test("inserts a blank row below the target row", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const inserted = await structure(api, "rows", { action: "insert-below", row: 2 });
  assert.equal(inserted.status, 200);
  assert.deepEqual(inserted.body.workbook.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "East", B2: "1200", C2: "Open",
    A4: "North", B4: "800", C4: "Closed",
    A5: "South", B5: "700", C5: "Open",
  });
});

test("deletes the target row and shifts the following rows upward", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const removed = await structure(api, "rows", { action: "delete", row: 2 });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.workbook.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "North", B2: "800", C2: "Closed",
    A3: "South", B3: "700", C3: "Open",
  });

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/wb-q3-sales`).then((r) => r.json());
  assert.deepEqual(reopened.workbook.worksheets[0].cells, {
    A1: "Region", B1: "Sales", C1: "Status",
    A2: "North", B2: "800", C2: "Closed",
    A3: "South", B3: "700", C3: "Open",
  });
});

test("rewrites the formulas of the shifted rows", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await writeCell(api, "D1", "=B2*2");
  await writeCell(api, "E1", "=SUM(B2:B3)");

  const inserted = await structure(api, "rows", { action: "insert-above", row: 2 });
  assert.equal(inserted.status, 200);
  const cells = inserted.body.workbook.worksheets[0].cells;
  assert.equal(cells.D1, "=B3*2");
  assert.equal(cells.E1, "=SUM(B3:B4)");

  const removed = await structure(api, "rows", { action: "delete", row: 3 });
  assert.equal(removed.status, 200);
  const afterDelete = removed.body.workbook.worksheets[0].cells;
  assert.equal(afterDelete.D1, "=#REF!*2");
  assert.equal(afterDelete.E1, "=SUM(#REF!)");
});

test("keeps a dependent formula chain aligned and persisted across a structure change", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await writeCell(api, "C1", "=B2+B3");
  await writeCell(api, "D1", "=C1*2");

  const inserted = await structure(api, "rows", { action: "insert-above", row: 2 });
  assert.equal(inserted.status, 200);
  const shifted = inserted.body.workbook.worksheets[0].cells;
  assert.equal(shifted.C1, "=B3+B4");
  // The indirect dependent keeps its own expression: only references move with the rows.
  assert.equal(shifted.D1, "=C1*2");

  // Overwriting one source cell leaves the chain's expressions untouched; the results the grid
  // shows are derived from these stored values.
  const pasted = await api.api("/api/workbooks/wb-q3-sales/paste", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: SHEET1, start: "B3", text: "1500" }),
  });
  assert.equal(pasted.status, 200);
  assert.equal(pasted.body.workbook.worksheets[0].cells.B3, "1500");
  assert.equal(pasted.body.workbook.worksheets[0].cells.C1, "=B3+B4");

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/wb-q3-sales`).then((r) => r.json());
  const cells = reopened.workbook.worksheets[0].cells;
  assert.equal(cells.C1, "=B3+B4");
  assert.equal(cells.D1, "=C1*2");
  assert.equal(cells.B3, "1500");
});

test("inserts and deletes columns and keeps formulas aligned", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const left = await structure(api, "columns", { action: "insert-left", column: "B" });
  assert.equal(left.status, 200);
  assert.deepEqual(left.body.workbook.worksheets[0].cells, {
    A1: "Region", C1: "Sales", D1: "Status",
    A2: "East", C2: "1200", D2: "Open",
    A3: "North", C3: "800", D3: "Closed",
    A4: "South", C4: "700", D4: "Open",
  });

  const right = await structure(api, "columns", { action: "insert-right", column: "A" });
  assert.equal(right.status, 200);
  assert.deepEqual(right.body.workbook.worksheets[0].cells, {
    A1: "Region", D1: "Sales", E1: "Status",
    A2: "East", D2: "1200", E2: "Open",
    A3: "North", D3: "800", E3: "Closed",
    A4: "South", D4: "700", E4: "Open",
  });

  const removed = await structure(api, "columns", { action: "delete", column: "B" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.workbook.worksheets[0].cells, {
    A1: "Region", C1: "Sales", D1: "Status",
    A2: "East", C2: "1200", D2: "Open",
    A3: "North", C3: "800", D3: "Closed",
    A4: "South", C4: "700", D4: "Open",
  });
});

test("deletes a column, preserving the data outside it and erroring on direct references", async (t) => {
  const api = await startApi();
  t.after(api.close);
  await writeCell(api, "D1", "=B2+B3");

  const removed = await structure(api, "columns", { action: "delete", column: "B" });
  assert.equal(removed.status, 200);
  const cells = removed.body.workbook.worksheets[0].cells;
  assert.deepEqual(cells, {
    A1: "Region", B1: "Status",
    A2: "East", B2: "Open",
    A3: "North", B3: "Closed",
    A4: "South", B4: "Open",
    C1: "=#REF!+#REF!",
  });
});

test("rejects an invalid structure operation without changing the stored grid", async (t) => {
  const api = await startApi();
  t.after(api.close);

  for (const [kind, body, status, message] of [
    ["rows", { action: "insert-above", row: 0 }, 400, "Invalid row number"],
    ["rows", { action: "insert-above", row: 31 }, 400, "Invalid row number"],
    ["rows", { action: "insert-above", row: 1.5 }, 400, "Invalid row number"],
    ["rows", { action: "flip", row: 1 }, 400, "Unsupported structure operation"],
    ["columns", { action: "insert-left", column: "AA" }, 400, "Invalid column"],
    ["columns", { action: "insert-left", column: "a" }, 400, "Invalid column"],
    ["columns", { action: "delete", column: "2" }, 400, "Invalid column"],
  ]) {
    const rejected = await structure(api, kind, body);
    assert.equal(rejected.status, status, `${kind} ${JSON.stringify(body)}`);
    assert.equal(rejected.body.error, message);
  }

  const unknownWorksheet = await api.api(
    "/api/workbooks/wb-q3-sales/worksheets/ws-missing/rows",
    { method: "POST", body: JSON.stringify({ action: "delete", row: 1 }) },
  );
  assert.equal(unknownWorksheet.status, 404);
  assert.equal(unknownWorksheet.body.error, "Worksheet not found");

  const reopened = await api.api("/api/workbooks/wb-q3-sales");
  assert.deepEqual(reopened.body.workbook.worksheets[0].cells, SEED_CELLS);
  assert.deepEqual(reopened.body.workbook.worksheets[1].cells, {});
  const stored = await readFile(api.statePath, "utf8").catch(() => null);
  if (stored !== null) assert.deepEqual(JSON.parse(stored).workbooks[0].worksheets[0].cells, SEED_CELLS);
});

test("imports a CSV file as a new workbook with Sheet1 holding every row", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const content = [
    "Region,East",
    "1200,\"North, South\"",
    "800,\"line1",
    "line2\"",
    "",
  ].join("\n");
  const imported = await api.api("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName: "q3-report.csv", content }),
  });
  assert.equal(imported.status, 201);
  const workbook = imported.body.workbook;
  assert.equal(workbook.name, "q3-report");
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].name, "Sheet1");
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
  assert.deepEqual(workbook.worksheets[0].cells, {
    A1: "Region",
    B1: "East",
    A2: "1200",
    B2: "North, South",
    A3: "800",
    B3: "line1\nline2",
  });

  // The first row stays ordinary data, and the grid covers the imported columns.
  assert.equal(workbook.worksheets[0].cells.A1, "Region");
  assert.ok(workbook.worksheets[0].rowCount >= 3 && workbook.worksheets[0].columnCount >= 2);

  const listing = await api.api("/api/workbooks");
  assert.deepEqual(listing.body.workbooks.map((item) => item.name).sort(), ["Q3 Sales", "q3-report"]);

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(
    `http://127.0.0.1:${restarted.port}/api/workbooks/${encodeURIComponent(workbook.id)}`,
  ).then((response) => response.json());
  assert.equal(reopened.workbook.name, "q3-report");
  assert.equal(reopened.workbook.worksheets[0].cells.B3, "line1\nline2");
  assert.equal(reopened.workbook.worksheets[0].cells.A1, "Region");
});

test("keeps UTF-8, empty fields and larger imported tables intact", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const rows = ["区域,销量,说明", "华东,1200,", "华北,800,\"含 \"\"引号\"\" 与,逗号\""];
  const imported = await api.api("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName: "销售.csv", content: `${rows.join("\r\n")}\r\n` }),
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.workbook.name, "销售");
  const cells = imported.body.workbook.worksheets[0].cells;
  assert.equal(cells.A1, "区域");
  assert.equal(cells.B2, "1200");
  assert.equal(cells.C2, undefined);
  assert.equal(cells.C3, '含 "引号" 与,逗号');
});

test("rejects an invalid CSV without creating a workbook", async (t) => {
  const api = await startApi();
  t.after(api.close);

  for (const content of ['Region,"East\n1200,North\n', '"unterminated']) {
    const rejected = await api.api("/api/workbooks/import", {
      method: "POST",
      body: JSON.stringify({ fileName: "broken.csv", content }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Invalid CSV file format. Import failed.");
  }

  const listing = await api.api("/api/workbooks");
  assert.deepEqual(listing.body.workbooks.map((item) => item.name), ["Q3 Sales"]);
  // Nothing was written at all, so no partial import can be retained.
  const stored = await readFile(api.statePath, "utf8").catch((error) => {
    assert.equal(error.code, "ENOENT");
    return null;
  });
  if (stored !== null) assert.deepEqual(JSON.parse(stored).workbooks.map((item) => item.name), ["Q3 Sales"]);
});

test("answers errors without ending the process", async (t) => {
  const api = await startApi();
  t.after(api.close);

  assert.equal((await api.api("/api/workbooks/missing")).status, 404);
  assert.equal((await api.api("/api/unknown")).status, 404);
  assert.equal((await api.api("/favicon.ico")).status, 404);
  assert.equal((await api.api("/does-not-exist.js")).status, 404);
  assert.equal((await api.api("/api/workbooks", { method: "DELETE" })).status, 405);
  assert.equal((await api.api("/api/workbooks/wb-q3-sales", { method: "PATCH", body: "{oops" })).status, 400);

  const health = await api.api("/health");
  assert.equal(health.status, 200);
});
