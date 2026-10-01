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
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-undo-"));
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

function sheetOf(workbook, worksheetId = "ws-q3-sales-sheet1") {
  return workbook.worksheets.find((sheet) => sheet.id === worksheetId);
}

function setCell(api, cell, value, worksheetId = "ws-q3-sales-sheet1") {
  return api.api("/api/workbooks/wb-q3-sales/cells", {
    method: "PUT",
    body: JSON.stringify({ worksheetId, cell, value }),
  });
}

function undo(api, workbookId = "wb-q3-sales") {
  return api.api(`/api/workbooks/${workbookId}/undo`, { method: "POST" });
}

function redo(api, workbookId = "wb-q3-sales") {
  return api.api(`/api/workbooks/${workbookId}/redo`, { method: "POST" });
}

test("undoes and redoes a cell edit, in reverse order, and keeps the result after a restart", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const edited = await setCell(api, "A2", "West");
  assert.equal(edited.status, 200);
  assert.equal(edited.body.workbook.canUndo, true);
  assert.equal(edited.body.workbook.canRedo, false);

  const second = await setCell(api, "B2", "1500");
  assert.equal(second.status, 200);

  // Consecutive undos restore the changes in reverse order.
  const firstUndo = await undo(api);
  assert.equal(sheetOf(firstUndo.body.workbook).cells.B2, "1200");
  assert.equal(sheetOf(firstUndo.body.workbook).cells.A2, "West");
  assert.equal(firstUndo.body.workbook.canRedo, true);

  const secondUndo = await undo(api);
  const reverted = sheetOf(secondUndo.body.workbook).cells;
  assert.equal(reverted.A2, "East");
  assert.equal(reverted.B2, "1200");
  assert.deepEqual(
    [reverted.A1, reverted.B1, reverted.A3, reverted.B3],
    ["Region", "Sales", "North", "800"],
  );

  // Redo reapplies the complete (both) operations that were undone.
  const firstRedo = await redo(api);
  assert.equal(sheetOf(firstRedo.body.workbook).cells.A2, "West");
  assert.equal(firstRedo.body.workbook.canRedo, true);
  const secondRedo = await redo(api);
  assert.equal(sheetOf(secondRedo.body.workbook).cells.A2, "West");
  assert.equal(sheetOf(secondRedo.body.workbook).cells.B2, "1500");
  assert.equal(secondRedo.body.workbook.canRedo, false);

  // The visible state after the last redo is what the stored state holds.
  const restarted = await api.restart();
  t.after(restarted.close);
  const persisted = sheetOf((await restarted.get("/api/workbooks/wb-q3-sales")).body.workbook).cells;
  assert.equal(persisted.A2, "West");
  assert.equal(persisted.B2, "1500");
});

test("undoes a bulk paste and a row structure change, restoring cells, structure and rule ranges", async (t) => {
  const api = await startApi((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "dv-1", type: "number-range", range: { start: "A2", end: "B2" }, min: 0, max: 100,
        message: "Please enter a number from 0 to 100" },
    ];
  });
  t.after(api.close);

  const pasted = await api.api("/api/workbooks/wb-q3-sales/paste", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: "ws-q3-sales-sheet1", start: "D1", text: "East\t1200\nNorth\t800" }),
  });
  assert.equal(pasted.status, 200);
  assert.equal(sheetOf(pasted.body.workbook).cells.E2, "800");

  const undone = await undo(api);
  const afterPasteUndo = sheetOf(undone.body.workbook);
  assert.equal(afterPasteUndo.cells.D1, undefined);
  assert.equal(afterPasteUndo.cells.E2, undefined);
  assert.equal(afterPasteUndo.cells.A1, "Region");

  const inserted = await api.api("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/rows", {
    method: "POST",
    body: JSON.stringify({ action: "insert-above", row: 2 }),
  });
  assert.equal(inserted.status, 200);
  const shifted = sheetOf(inserted.body.workbook);
  assert.equal(shifted.cells.A3, "East");
  assert.equal(shifted.cells.A2, undefined);
  assert.deepEqual(shifted.validations[0].range, { start: "A3", end: "B3" });

  const structureUndo = await undo(api);
  const restored = sheetOf(structureUndo.body.workbook);
  assert.equal(restored.cells.A2, "East");
  assert.equal(restored.cells.A3, "North");
  assert.deepEqual(restored.validations[0].range, { start: "A2", end: "B2" });

  // Redo brings the whole structure change back.
  const structureRedo = await redo(api);
  const remade = sheetOf(structureRedo.body.workbook);
  assert.equal(remade.cells.A3, "East");
  assert.deepEqual(remade.validations[0].range, { start: "A3", end: "B3" });
});

test("undoes and redoes a range move, restoring source and target together", async (t) => {
  const api = await startApi((state) => {
    state.workbooks[0].worksheets[0].cells = {
      A1: "Item", B1: "Qty", A2: "Pen", B2: "4",
    };
  });
  t.after(api.close);

  const moved = await api.api("/api/workbooks/wb-q3-sales/worksheets/ws-q3-sales-sheet1/range-transfer", {
    method: "POST",
    body: JSON.stringify({
      source: { start: "A1", end: "B2" },
      target: { start: "D1", end: "E2" },
      mode: "cut",
    }),
  });
  assert.equal(moved.status, 200);
  assert.equal(sheetOf(moved.body.workbook).cells.A1, undefined);

  const undone = await undo(api);
  const restored = sheetOf(undone.body.workbook).cells;
  assert.deepEqual([restored.A1, restored.B1, restored.A2, restored.B2], ["Item", "Qty", "Pen", "4"]);
  assert.equal(restored.D1, undefined);
  assert.equal(restored.E2, undefined);

  const redone = await redo(api);
  const again = sheetOf(redone.body.workbook).cells;
  assert.equal(again.A1, undefined);
  assert.deepEqual([again.D1, again.E1, again.D2, again.E2], ["Item", "Qty", "Pen", "4"]);
});

test("undo of one workbook never modifies another workbook", async (t) => {
  const api = await startApi();
  t.after(api.close);

  const created = await api.api("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name: "Other book" }),
  });
  const otherId = created.body.workbook.id;
  const otherSheetId = created.body.workbook.worksheets[0].id;

  await api.api(`/api/workbooks/${otherId}/cells`, {
    method: "PUT",
    body: JSON.stringify({ worksheetId: otherSheetId, cell: "A1", value: "Other value" }),
  });
  await setCell(api, "A2", "West");

  const undone = await undo(api);
  assert.equal(sheetOf(undone.body.workbook).cells.A2, "East");

  const other = await api.api(`/api/workbooks/${otherId}`);
  assert.equal(sheetOf(other.body.workbook, otherSheetId).cells.A1, "Other value");
  assert.equal(other.body.workbook.canUndo, true);
});

test("a new modification after an undo drops the redo branch", async (t) => {
  const api = await startApi();
  t.after(api.close);

  await setCell(api, "A2", "West");
  const undone = await undo(api);
  assert.equal(undone.body.workbook.canRedo, true);

  const fresh = await setCell(api, "C3", "New");
  assert.equal(fresh.body.workbook.canRedo, false);

  const refused = await redo(api);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "Nothing to redo");
  const worksheet = sheetOf((await api.api("/api/workbooks/wb-q3-sales")).body.workbook);
  assert.equal(worksheet.cells.C3, "New");
  assert.equal(worksheet.cells.A2, "East");
});

test("a rejected operation is not recorded and empty stacks answer an explicit error", async (t) => {
  const api = await startApi((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "dv-1", type: "number-range", range: { start: "D1", end: "D1" }, min: 0, max: 100,
        message: "Please enter a number from 0 to 100" },
    ];
  });
  t.after(api.close);

  const refusedPaste = await api.api("/api/workbooks/wb-q3-sales/paste", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: "ws-q3-sales-sheet1", start: "D1", text: "1200" }),
  });
  assert.equal(refusedPaste.status, 400);

  const stillFresh = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(stillFresh.body.workbook.canUndo, false);

  const undoOnEmpty = await undo(api);
  assert.equal(undoOnEmpty.status, 400);
  assert.equal(undoOnEmpty.body.error, "Nothing to undo");
  const redoOnEmpty = await redo(api);
  assert.equal(redoOnEmpty.status, 400);
  assert.equal(redoOnEmpty.body.error, "Nothing to redo");

  const unknown = await undo(api, "wb-missing");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "Workbook not found");
});
