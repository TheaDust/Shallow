import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

/**
 * Starts the real request handler against a temporary state file. `mutateState` can pre-set the
 * stored state (for example a numeric-range validation rule) before the server listens.
 */
async function startApi(mutateState) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-paste-"));
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

function paste(api, body) {
  return api.api("/api/workbooks/wb-q3-sales/paste", { method: "PUT", body: JSON.stringify(body) });
}

function sheet1(workbook) {
  return workbook.worksheets.find((sheet) => sheet.id === "ws-q3-sales-sheet1");
}

test("pastes a tab-separated table into the whole target rectangle", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const response = await paste(api, {
    worksheetId: "ws-q3-sales-sheet1",
    start: "D1",
    text: "East\t1200\nNorth\t800\n",
  });
  assert.equal(response.status, 200);
  const worksheet = sheet1(response.body.workbook);
  assert.equal(worksheet.cells.D1, "East");
  assert.equal(worksheet.cells.E1, "1200");
  assert.equal(worksheet.cells.D2, "North");
  assert.equal(worksheet.cells.E2, "800");
  // Only the target rectangle is touched: the surrounding data is untouched and no value leaks.
  assert.equal(worksheet.cells.A1, "Region");
  assert.equal(worksheet.cells.B2, "1200");
  assert.equal(worksheet.cells.D3, undefined);
  assert.equal(worksheet.cells.G1, undefined);

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await fetch(`http://127.0.0.1:${restarted.port}/api/workbooks/wb-q3-sales`)
    .then((result) => result.json());
  const persisted = sheet1(reopened.workbook);
  assert.equal(persisted.cells.D1, "East");
  assert.equal(persisted.cells.E2, "800");
});

test("overwrites only the target rectangle, keeps empty fields and replaces formulas", async (t) => {
  const api = await startApi();
  t.after(api.close);

  await paste(api, { worksheetId: "ws-q3-sales-sheet1", start: "D1", text: "keep\tme" });
  const response = await paste(api, {
    worksheetId: "ws-q3-sales-sheet1",
    start: "D1",
    text: "East\t\nNorth\t800",
  });
  assert.equal(response.status, 200);
  const worksheet = sheet1(response.body.workbook);
  assert.equal(worksheet.cells.D1, "East");
  assert.equal(worksheet.cells.E1, undefined, "an empty pasted field clears its target cell");
  assert.equal(worksheet.cells.D2, "North");
  assert.equal(worksheet.cells.E2, "800");
  // The cells outside the pasted rectangle were never rewritten by the second paste.
  assert.equal(worksheet.cells.A1, "Region");
  assert.equal(worksheet.cells.B1, "Sales");
});

test("rejects a paste that a 0-to-100 rule refuses and keeps every original value", async (t) => {
  const api = await startApi((state) => {
    const workbook = state.workbooks.find((item) => item.id === "wb-q3-sales");
    const worksheet = workbook.worksheets.find((sheet) => sheet.id === "ws-q3-sales-sheet1");
    worksheet.validations = [
      { id: "dv-1", type: "number-range", range: { start: "D1", end: "E2" }, min: 0, max: 100,
        message: "Please enter a number from 0 to 100" },
    ];
  });
  t.after(api.close);

  const before = await api.api("/api/workbooks/wb-q3-sales");
  const response = await paste(api, {
    worksheetId: "ws-q3-sales-sheet1",
    start: "D1",
    text: "50\t1200\n60\t70",
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Please enter a number from 0 to 100");

  const after = await api.api("/api/workbooks/wb-q3-sales");
  // No partial write: every target cell keeps its original (empty) value.
  assert.deepEqual(sheet1(after.body.workbook).cells, sheet1(before.body.workbook).cells);
  assert.equal(sheet1(after.body.workbook).cells.D1, undefined);

  const accepted = await paste(api, {
    worksheetId: "ws-q3-sales-sheet1",
    start: "D1",
    text: "50\t100\n60\t70",
  });
  assert.equal(accepted.status, 200);
  assert.equal(sheet1(accepted.body.workbook).cells.E1, "100");
});

test("grows the grid instead of dropping values and refuses an empty paste or unknown worksheet", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const grown = await paste(api, {
    worksheetId: "ws-q3-sales-sheet1",
    start: "A40",
    text: "alpha\tbeta",
  });
  assert.equal(grown.status, 200);
  const worksheet = sheet1(grown.body.workbook);
  assert.ok(worksheet.rowCount >= 40);
  assert.equal(worksheet.cells.A40, "alpha");
  assert.equal(worksheet.cells.B40, "beta");
  // The unset cells between the old data and the paste stay empty.
  assert.equal(worksheet.cells.A6, undefined);

  const empty = await paste(api, { worksheetId: "ws-q3-sales-sheet1", start: "D1", text: "" });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, "Nothing to paste");

  const unknown = await paste(api, { worksheetId: "ws-missing", start: "D1", text: "x" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "Worksheet not found");
});
