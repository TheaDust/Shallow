import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { seedState } from "../src/domain/workbook-model.mjs";

const SEED_WORKBOOK_ID = "workbook-q3-sales";
const SHEET_1 = "workbook-q3-sales-sheet-1";

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-history-"));
  if (prepare) {
    const state = prepare(seedState());
    await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
  const { handler } = createApp({ dataDir });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    dataDir,
    async call(path, init) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    /** The worksheet cells as they are stored on disk right now. */
    async storedCells(workbookId = SEED_WORKBOOK_ID, worksheetId = SHEET_1) {
      const raw = await readFile(join(dataDir, "workbooks.json"), "utf8");
      const state = JSON.parse(raw);
      const workbook = state.workbooks.find((entry) => entry.id === workbookId);
      return workbook.worksheets.find((entry) => entry.id === worksheetId).cells;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function cellsPath(worksheetId = SHEET_1, workbookId = SEED_WORKBOOK_ID) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/cells`;
}

async function writeCell(app, row, col, value, workbookId = SEED_WORKBOOK_ID, worksheetId = SHEET_1) {
  return app.call(cellsPath(worksheetId, workbookId), {
    method: "POST",
    body: JSON.stringify({ start: { row, col }, values: [[value]] }),
  });
}

function historyPath(action, workbookId = SEED_WORKBOOK_ID) {
  return `/api/workbooks/${workbookId}/${action}`;
}

test("undo restores the value an edit replaced and redo reapplies it", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const before = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}`);
  assert.deepEqual(before.body.history, { canUndo: false, canRedo: false });

  const edited = await writeCell(app, 0, 0, "West");
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.history, { canUndo: true, canRedo: false });
  assert.equal(edited.body.worksheet.cells.A1, "West");

  const undone = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.workbook.worksheets[0].cells.A1, "Region");
  assert.deepEqual(undone.body.history, { canUndo: false, canRedo: true });
  assert.equal(await app.storedCells().then((cells) => cells.A1), "Region");

  const redone = await app.call(historyPath("redo"), { method: "POST" });
  assert.equal(redone.status, 200);
  assert.equal(redone.body.workbook.worksheets[0].cells.A1, "West");
  assert.deepEqual(redone.body.history, { canUndo: true, canRedo: false });
  assert.equal(await app.storedCells().then((cells) => cells.A1), "West");
});

test("consecutive undos restore the operations in reverse order", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await writeCell(app, 0, 3, "East");
  await writeCell(app, 1, 3, "North");

  const first = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(first.body.workbook.worksheets[0].cells.D2, undefined);
  assert.equal(first.body.workbook.worksheets[0].cells.D1, "East");

  const second = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(second.body.workbook.worksheets[0].cells.D1, undefined);
  assert.deepEqual(second.body.history, { canUndo: false, canRedo: true });
  // Both undos are on the redo stack; redo replays them oldest first.
  const redoOne = await app.call(historyPath("redo"), { method: "POST" });
  assert.equal(redoOne.body.workbook.worksheets[0].cells.D1, "East");
  assert.equal(redoOne.body.workbook.worksheets[0].cells.D2, undefined);
  const redoTwo = await app.call(historyPath("redo"), { method: "POST" });
  assert.equal(redoTwo.body.workbook.worksheets[0].cells.D2, "North");
});

test("undo restores formulas, the grid structure and rule ranges together", async (t) => {
  const app = await startApp((state) => {
    state.workbooks[0].worksheets[0].cells.D1 = "=B2+B3";
    state.workbooks[0].worksheets[0].validations = [
      { id: "rule-1", type: "numeric", min: 0, max: 100, range: { minRow: 1, maxRow: 2, minCol: 0, maxCol: 0 } },
    ];
    return state;
  });
  t.after(() => app.close());

  const inserted = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SHEET_1}/structure`,
    { method: "POST", body: JSON.stringify({ operation: "insertRowAbove", index: 0 }) },
  );
  assert.equal(inserted.status, 200);
  assert.equal(inserted.body.worksheet.rowCount, 51);
  assert.equal(inserted.body.worksheet.cells.D2, "=B3+B4");
  assert.deepEqual(inserted.body.worksheet.validations[0].range, {
    minRow: 2,
    maxRow: 3,
    minCol: 0,
    maxCol: 0,
  });

  const undone = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(undone.status, 200);
  const worksheet = undone.body.workbook.worksheets[0];
  assert.equal(worksheet.rowCount, 50);
  assert.equal(worksheet.cells.D1, "=B2+B3");
  assert.equal(worksheet.cells.A1, "Region");
  assert.deepEqual(worksheet.validations[0].range, { minRow: 1, maxRow: 2, minCol: 0, maxCol: 0 });
});

test("undo restores both sides of a range move", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const moved = await app.call(
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SHEET_1}/transfer`,
    {
      method: "POST",
      body: JSON.stringify({
        source: { anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } },
        target: { anchor: { row: 0, col: 3 }, focus: { row: 0, col: 3 } },
        mode: "cut",
      }),
    },
  );
  assert.equal(moved.status, 200);
  assert.equal(moved.body.worksheet.cells.A1, undefined);
  assert.equal(moved.body.worksheet.cells.D1, "Region");

  const undone = await app.call(historyPath("undo"), { method: "POST" });
  const cells = undone.body.workbook.worksheets[0].cells;
  assert.equal(cells.A1, "Region");
  assert.equal(cells.B2, "1200");
  assert.equal(cells.D1, undefined);
  assert.equal(cells.E2, undefined);
});

test("a rejected write never becomes undoable", async (t) => {
  const app = await startApp((state) => {
    state.workbooks[0].worksheets[0].validations = [
      { id: "rule-1", type: "numeric", min: 0, max: 100, range: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 } },
    ];
    return state;
  });
  t.after(() => app.close());

  const rejected = await writeCell(app, 0, 0, "101");
  assert.equal(rejected.status, 422);
  const detail = await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}`);
  assert.deepEqual(detail.body.history, { canUndo: false, canRedo: false });

  const undone = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(undone.status, 200);
  assert.deepEqual(undone.body.history, { canUndo: false, canRedo: false });
  assert.equal(undone.body.workbook.worksheets[0].cells.A1, "Region");
});

test("a new modification after an undo disables redo", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await writeCell(app, 0, 3, "East");
  const undone = await app.call(historyPath("undo"), { method: "POST" });
  assert.deepEqual(undone.body.history, { canUndo: false, canRedo: true });

  const fresh = await writeCell(app, 1, 3, "North");
  assert.deepEqual(fresh.body.history, { canUndo: true, canRedo: false });

  // The old branch is gone: redo leaves the fresh edit in place.
  const redone = await app.call(historyPath("redo"), { method: "POST" });
  assert.deepEqual(redone.body.history, { canUndo: true, canRedo: false });
  assert.equal(redone.body.workbook.worksheets[0].cells.D2, "North");
  assert.equal(redone.body.workbook.worksheets[0].cells.D1, undefined);
});

test("undo only touches the workbook it belongs to", async (t) => {
  const app = await startApp((state) => {
    state.workbooks.push({
      id: "workbook-other",
      name: "Other",
      createdAt: "2024-07-01T09:00:00.000Z",
      updatedAt: "2024-07-01T09:00:00.000Z",
      activeWorksheetId: "workbook-other-sheet-1",
      worksheets: [
        {
          id: "workbook-other-sheet-1",
          name: "Sheet1",
          rowCount: 50,
          columnCount: 26,
          cells: { A1: "keep" },
          selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
          validations: [],
        },
      ],
    });
    return state;
  });
  t.after(() => app.close());

  await writeCell(app, 0, 0, "West");
  await writeCell(app, 0, 0, "South", "workbook-other", "workbook-other-sheet-1");

  const undone = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(undone.body.workbook.worksheets[0].cells.A1, "Region");

  const other = await app.call("/api/workbooks/workbook-other");
  assert.equal(other.body.workbook.worksheets[0].cells.A1, "South");
  assert.deepEqual(other.body.history, { canUndo: true, canRedo: false });
});

test("undo keeps the worksheet the user is looking at open", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  await writeCell(app, 0, 0, "West");
  await app.call(`/api/workbooks/${SEED_WORKBOOK_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ activeWorksheetId: "workbook-q3-sales-sheet-2" }),
  });

  const undone = await app.call(historyPath("undo"), { method: "POST" });
  assert.equal(undone.body.workbook.activeWorksheetId, "workbook-q3-sales-sheet-2");
  assert.equal(undone.body.workbook.worksheets[0].cells.A1, "Region");
});
