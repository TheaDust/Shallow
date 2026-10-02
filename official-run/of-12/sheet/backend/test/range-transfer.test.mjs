import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

/** Starts the real request handler against a temporary state file. */
async function startApi(mutateState) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-range-"));
  const statePath = join(directory, "workbooks.json");
  const state = createInitialState();
  if (mutateState) mutateState(state);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

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
    api,
    async restart() {
      const restarted = createJsonStore(statePath, createInitialState());
      const newHandler = createRequestHandler({ store: restarted, staticRoot: join(directory, "no-dist") });
      const newServer = createServer(newHandler);
      await new Promise((resolve) => newServer.listen(0, "127.0.0.1", resolve));
      const { port: newPort } = newServer.address();
      return {
        port: newPort,
        get: async (path) => {
          const response = await fetch(`http://127.0.0.1:${newPort}${path}`);
          const text = await response.text();
          return { status: response.status, body: text ? JSON.parse(text) : null };
        },
        close: async () => {
          newServer.closeAllConnections?.();
          await new Promise((resolve) => newServer.close(resolve));
        },
      };
    },
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function transfer(api, body, worksheetId = "ws-q3-sales-sheet1") {
  return api.api(`/api/workbooks/wb-q3-sales/worksheets/${worksheetId}/range-transfer`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function sheet1(workbook) {
  return workbook.worksheets.find((sheet) => sheet.id === "ws-q3-sales-sheet1");
}

test("copies a rectangular range onto a target range and keeps the source", async (t) => {
  const api = await startApi((state) => {
    const worksheet = state.workbooks[0].worksheets[0];
    worksheet.cells = { ...worksheet.cells, A1: "Item", B1: "Qty", A2: "Pen", B2: "4" };
  });
  t.after(api.close);

  const response = await transfer(api, {
    worksheetId: "ws-q3-sales-sheet1",
    source: { start: "A1", end: "B2" },
    target: { start: "D1", end: "E2" },
    mode: "copy",
  });
  assert.equal(response.status, 200);
  const worksheet = sheet1(response.body.workbook);
  assert.deepEqual(
    [worksheet.cells.D1, worksheet.cells.E1, worksheet.cells.D2, worksheet.cells.E2],
    ["Item", "Qty", "Pen", "4"],
  );
  // A copy leaves the source range exactly as it was, and never touches other cells.
  assert.deepEqual(
    [worksheet.cells.A1, worksheet.cells.B1, worksheet.cells.A2, worksheet.cells.B2],
    ["Item", "Qty", "Pen", "4"],
  );
  assert.equal(worksheet.cells.C1, "Status");
  assert.equal(worksheet.cells.D3, undefined);

  // The whole rectangle is persisted: a restarted server shows the same values.
  const restarted = await api.restart();
  t.after(restarted.close);
  const persisted = sheet1((await restarted.get("/api/workbooks/wb-q3-sales")).body.workbook);
  assert.equal(persisted.cells.D1, "Item");
  assert.equal(persisted.cells.E2, "4");
  assert.equal(persisted.cells.A2, "Pen");
});

test("adjusts relative references by the target offset and keeps absolute references", async (t) => {
  const api = await startApi((state) => {
    const worksheet = state.workbooks[0].worksheets[0];
    worksheet.cells = {
      ...worksheet.cells,
      C1: "=A1+$B$1+SUM(A1:B2)",
      C2: '=IF(A1>0,"A1 is fine",A1)',
    };
  });
  t.after(api.close);

  const moved = await transfer(api, {
    worksheetId: "ws-q3-sales-sheet1",
    source: { start: "C1", end: "C2" },
    target: { start: "D3", end: "D4" },
    mode: "copy",
  });
  assert.equal(moved.status, 200);
  const worksheet = sheet1(moved.body.workbook);
  assert.equal(worksheet.cells.D3, "=B3+$B$1+SUM(B3:C4)");
  // The offset is the same for the whole rectangle, so C2's formula moves by the rectangle's
  // offset (+1 column, +2 rows) even though the cell itself lands on D4.
  assert.equal(worksheet.cells.D4, '=IF(B3>0,"A1 is fine",B3)');
  // The original formula cells keep their own expressions.
  assert.equal(worksheet.cells.C1, "=A1+$B$1+SUM(A1:B2)");

  // A reference pushed outside the grid becomes an explicit error.
  const edge = await transfer(api, {
    worksheetId: "ws-q3-sales-sheet1",
    source: { start: "C1", end: "C1" },
    target: { start: "A40", end: "A40" },
    mode: "copy",
  });
  const outward = sheet1(edge.body.workbook);
  assert.equal(outward.cells.A40, "=#REF!+$B$1+SUM(#REF!)");
});

test("cuts a range onto the target: the target is written and the source cleared", async (t) => {
  const api = await startApi((state) => {
    const worksheet = state.workbooks[0].worksheets[0];
    worksheet.cells = { ...worksheet.cells, A1: "Item", B1: "Qty", A2: "Pen", B2: "4" };
  });
  t.after(api.close);

  const response = await transfer(api, {
    worksheetId: "ws-q3-sales-sheet1",
    source: { start: "A1", end: "B2" },
    target: { start: "D1", end: "E2" },
    mode: "cut",
  });
  assert.equal(response.status, 200);
  const worksheet = sheet1(response.body.workbook);
  assert.deepEqual(
    [worksheet.cells.D1, worksheet.cells.E1, worksheet.cells.D2, worksheet.cells.E2],
    ["Item", "Qty", "Pen", "4"],
  );
  for (const coordinate of ["A1", "B1", "A2", "B2"]) {
    assert.equal(worksheet.cells[coordinate], undefined, `${coordinate} must be cleared by the cut`);
  }

  const restarted = await api.restart();
  t.after(restarted.close);
  const persisted = sheet1((await restarted.get("/api/workbooks/wb-q3-sales")).body.workbook);
  assert.equal(persisted.cells.D2, "Pen");
  assert.equal(persisted.cells.A1, undefined);
});

test("rejects a transfer a 0-to-100 rule refuses and keeps source and target untouched", async (t) => {
  const api = await startApi((state) => {
    const worksheet = state.workbooks[0].worksheets[0];
    worksheet.cells = { ...worksheet.cells, A1: "Item", B1: "Qty", A2: "Pen", B2: "4" };
    worksheet.validations = [
      { id: "dv-1", type: "number-range", range: { start: "D1", end: "E2" }, min: 0, max: 100,
        message: "Please enter a number from 0 to 100" },
    ];
  });
  t.after(api.close);

  const before = sheet1((await api.api("/api/workbooks/wb-q3-sales")).body.workbook);
  for (const mode of ["copy", "cut"]) {
    const response = await transfer(api, {
      worksheetId: "ws-q3-sales-sheet1",
      source: { start: "A1", end: "B2" },
      target: { start: "D1", end: "E2" },
      mode,
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Please enter a number from 0 to 100");
    const after = sheet1((await api.api("/api/workbooks/wb-q3-sales")).body.workbook);
    // No partial write: neither the source nor the target changed.
    assert.deepEqual(after.cells, before.cells);
  }

  // A transfer whose values satisfy the rule is accepted.
  const accepted = await transfer(api, {
    worksheetId: "ws-q3-sales-sheet1",
    source: { start: "B2", end: "B2" },
    target: { start: "D1", end: "D1" },
    mode: "copy",
  });
  assert.equal(accepted.status, 200);
  assert.equal(sheet1(accepted.body.workbook).cells.D1, "4");
});

test("refuses an unusable range, mode or worksheet without changing anything", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const rows = [
    [{ source: { start: "A1", end: "B2" }, target: { start: "D1", end: "E2" }, mode: "move" },
      "Unsupported range operation"],
    [{ source: { start: "A1", end: "nope" }, target: { start: "D1", end: "E2" }, mode: "copy" },
      "Invalid range"],
    [{ source: { start: "A1", end: "B2" }, target: {}, mode: "copy" }, "Invalid range"],
  ];
  for (const [body, message] of rows) {
    const response = await transfer(api, { worksheetId: "ws-q3-sales-sheet1", ...body });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, message);
  }
  const unknown = await transfer(api, {
    source: { start: "A1", end: "B2" },
    target: { start: "D1", end: "E2" },
    mode: "copy",
  }, "ws-missing");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "Worksheet not found");

  const worksheet = sheet1((await api.api("/api/workbooks/wb-q3-sales")).body.workbook);
  assert.equal(worksheet.cells.A1, "Region");
  assert.equal(worksheet.cells.D1, undefined);
});
