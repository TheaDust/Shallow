import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeRect, adjustFormulaRefs, applyRangeTransfer } from "../src/transfer.js";
import { loadData, saveData, getWorkbook, transferCells } from "../src/store.js";
import { createApp } from "../src/server.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-transfer-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("normalizeRect normalizes any corner order and rejects invalid coordinates", () => {
  assert.deepEqual(normalizeRect("A1", "B2"), {
    minCol: 1,
    maxCol: 2,
    minRow: 1,
    maxRow: 2,
    topLeft: "A1",
    bottomRight: "B2",
  });
  assert.deepEqual(normalizeRect("B2", "A1"), normalizeRect("A1", "B2"));
  assert.deepEqual(normalizeRect("E2", "D1"), {
    minCol: 4,
    maxCol: 5,
    minRow: 1,
    maxRow: 2,
    topLeft: "D1",
    bottomRight: "E2",
  });
  assert.equal(normalizeRect("bogus", "A1"), null);
  assert.equal(normalizeRect("A0", "A1"), null);
  assert.equal(normalizeRect("A1", null), null);
});

test("adjustFormulaRefs shifts relative references and keeps absolute ones", () => {
  assert.equal(adjustFormulaRefs("=A1", 3, 0), "=D1");
  assert.equal(adjustFormulaRefs("=$A$1", 3, 0), "=$A$1");
  assert.equal(adjustFormulaRefs("=$A1", 3, 5), "=$A6");
  assert.equal(adjustFormulaRefs("=A$1", 3, 5), "=D$1");
  assert.equal(adjustFormulaRefs("=SUM(A1:B2)", 3, 0), "=SUM(D1:E2)");
  assert.equal(adjustFormulaRefs("=A1+B1", -1, 0), "=#REF!+A1");
  assert.equal(adjustFormulaRefs("=SUM($A$1:B2)", 3, 0), "=SUM($A$1:E2)");
  assert.equal(adjustFormulaRefs("plain text", 3, 0), "plain text");
  assert.equal(adjustFormulaRefs(undefined, 3, 0), undefined);
});

function seedCells() {
  return { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" };
}

test("applyRangeTransfer copy writes the target rectangle and keeps the source", () => {
  const { cells, end } = applyRangeTransfer(
    seedCells(),
    "copy",
    normalizeRect("A1", "B2"),
    { col: 4, row: 1 },
  );
  assert.equal(cells.D1, "Item");
  assert.equal(cells.E1, "Qty");
  assert.equal(cells.D2, "Pen");
  assert.equal(cells.E2, "4");
  assert.equal(cells.A1, "Item");
  assert.equal(cells.B2, "4");
  assert.equal(end, "E2");
});

test("applyRangeTransfer copy adjusts formulas by the target offset", () => {
  const cells = { A1: "=B1", A2: "=$B$2", B1: "10", B2: "20" };
  const result = applyRangeTransfer(cells, "copy", normalizeRect("A1", "A2"), { col: 4, row: 1 });
  assert.equal(result.cells.D1, "=E1"); // relative reference shifted +3 columns
  assert.equal(result.cells.D2, "=$B$2"); // absolute reference unchanged
  assert.equal(result.cells.A1, "=B1"); // source untouched
});

test("applyRangeTransfer cut writes the target first, then clears the source", () => {
  const { cells, end } = applyRangeTransfer(
    seedCells(),
    "cut",
    normalizeRect("A1", "B2"),
    { col: 4, row: 1 },
  );
  assert.equal(cells.D1, "Item");
  assert.equal(cells.E1, "Qty");
  assert.equal(cells.D2, "Pen");
  assert.equal(cells.E2, "4");
  assert.equal(cells.A1, undefined);
  assert.equal(cells.B1, undefined);
  assert.equal(cells.A2, undefined);
  assert.equal(cells.B2, undefined);
  assert.equal(end, "E2");
});

test("applyRangeTransfer cut with an overlapping target keeps the moved values", () => {
  // cut A1:B2 (Item/Qty / Pen/4) and paste starting at B1: the new rectangle
  // B1:C2 overlaps the source; values must land correctly and only non-target
  // source cells (A1, A2) are cleared.
  const { cells } = applyRangeTransfer(seedCells(), "cut", normalizeRect("A1", "B2"), {
    col: 2,
    row: 1,
  });
  assert.equal(cells.B1, "Item");
  assert.equal(cells.C1, "Qty");
  assert.equal(cells.B2, "Pen");
  assert.equal(cells.C2, "4");
  assert.equal(cells.A1, undefined);
  assert.equal(cells.A2, undefined);
});

test("applyRangeTransfer cut pasting onto the same rectangle is a no-op", () => {
  const { cells } = applyRangeTransfer(seedCells(), "cut", normalizeRect("A1", "B2"), {
    col: 1,
    row: 1,
  });
  assert.deepEqual(cells, seedCells());
});

async function seed(t) {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  return await loadData();
}

test("transferCells copy persists and updates the selection to the pasted rectangle", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  const result = await transferCells(wb.id, sheet.id, "copy", { current: "A1", end: "B2" }, "D1");
  assert.equal(result.error, undefined);
  const cells = result.workbook.sheets[0].cells;
  assert.equal(cells.D1, "Item");
  assert.equal(cells.E1, "Qty");
  assert.equal(cells.D2, "Pen");
  assert.equal(cells.E2, "4");
  assert.equal(cells.A1, "Item"); // source stays
  assert.equal(cells.B2, "4");
  assert.deepEqual(result.workbook.sheets[0].selection, { current: "D1", end: "E2" });
  assert.equal(result.workbook.sheets[0].activeCell, "D1");
  // other worksheets unchanged
  assert.deepEqual(result.workbook.sheets[1].cells, {});
  // persists after reopening
  const reopened = await getWorkbook(wb.id);
  assert.equal(reopened.sheets[0].cells.D1, "Item");
  assert.equal(reopened.sheets[0].cells.E2, "4");
  assert.deepEqual(reopened.sheets[0].selection, { current: "D1", end: "E2" });
});

test("transferCells cut clears the source only with the target written, and persists", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const result = await transferCells(wb.id, wb.sheets[0].id, "cut", { current: "A1", end: "B2" }, "D1");
  assert.equal(result.error, undefined);
  const cells = result.workbook.sheets[0].cells;
  assert.equal(cells.D1, "Item");
  assert.equal(cells.E1, "Qty");
  assert.equal(cells.D2, "Pen");
  assert.equal(cells.E2, "4");
  assert.equal(cells.A1, undefined);
  assert.equal(cells.B2, undefined);
  const reopened = await getWorkbook(wb.id);
  assert.equal(reopened.sheets[0].cells.D1, "Item");
  assert.equal(reopened.sheets[0].cells.A1, undefined);
});

test("transferCells stores adjusted formulas and they recalculate from the new location", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  sheet.cells.B3 = "5";
  sheet.cells.A3 = "=B3"; // displays 5
  await saveData(data);
  const result = await transferCells(wb.id, sheet.id, "copy", { current: "A3", end: "A3" }, "D3");
  assert.equal(result.workbook.sheets[0].cells.D3, "=E3"); // adjusted relative reference
  const moved = await transferCells(wb.id, sheet.id, "copy", { current: "A3", end: "A3" }, "A4");
  assert.equal(moved.workbook.sheets[0].cells.A4, "=B4");
});

test("transferCells is atomic: validation failures leave every cell unchanged", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  sheet.cells.D1 = "original";
  await transferCells(wb.id, sheet.id, "copy", { current: "A1", end: "B2" }, "D1");
  const before = JSON.stringify(await loadData());
  for (const bad of [
    ["move", { current: "A1", end: "B2" }, "D1"], // unknown operation
    ["copy", { current: "bogus", end: "B2" }, "D1"], // invalid source
    ["copy", { current: "A1", end: "B2" }, "A0"], // invalid target
    ["copy", null, "D1"], // missing source
    ["copy", { current: "A1", end: "B2" }, null], // missing target
  ]) {
    const result = await transferCells(wb.id, sheet.id, bad[0], bad[1], bad[2]);
    assert.ok(result.error, "expected an error");
    assert.equal(JSON.stringify(await loadData()), before, "state must not change on failure");
  }
  const wbAfter = (await loadData()).workbooks[0];
  assert.equal(wbAfter.sheets[0].cells.D1, "Item");
  assert.deepEqual(wbAfter.sheets[0].selection, { current: "D1", end: "E2" });
});

test("transferCells reports NOT_FOUND for unknown workbook/sheet", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const missingWb = await transferCells("missing", wb.sheets[0].id, "copy", { current: "A1", end: "A1" }, "D1");
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await transferCells(wb.id, "missing", "copy", { current: "A1", end: "A1" }, "D1");
  assert.equal(missingSheet.error.code, "NOT_FOUND");
});

async function withServer(t, fn) {
  const dir = await tempDir(t);
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
  return { status: res.status, body: await res.json() };
}

async function sendJson(base, pathname, method, payload) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

test("POST /transfer copies the range and the result persists after reopening", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const wb = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    const sheetId = wb.sheets[0].id;
    const res = await sendJson(
      base,
      `/api/workbooks/${id}/sheets/${sheetId}/transfer`,
      "POST",
      { operation: "copy", source: { current: "A1", end: "B2" }, target: "D1" },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      A1: "Item",
      B1: "Qty",
      A2: "Pen",
      B2: "4",
      D1: "Item",
      E1: "Qty",
      D2: "Pen",
      E2: "4",
    });
    assert.deepEqual(res.body.workbook.sheets[0].selection, { current: "D1", end: "E2" });
    const reopened = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    assert.deepEqual(reopened.sheets[0].cells, res.body.workbook.sheets[0].cells);
    assert.deepEqual(reopened.sheets[0].selection, { current: "D1", end: "E2" });
  });
});

test("POST /transfer cuts the source range after writing the target, atomically", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const wb = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    const sheetId = wb.sheets[0].id;
    const res = await sendJson(
      base,
      `/api/workbooks/${id}/sheets/${sheetId}/transfer`,
      "POST",
      { operation: "cut", source: { current: "A1", end: "B2" }, target: "D1" },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      D1: "Item",
      E1: "Qty",
      D2: "Pen",
      E2: "4",
    });
  });
});

test("POST /transfer rejects invalid input with 400 and leaves the seeded state", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const wb = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    const sheetId = wb.sheets[0].id;
    const url = `/api/workbooks/${id}/sheets/${sheetId}/transfer`;
    const badOp = await sendJson(base, url, "POST", {
      operation: "move",
      source: { current: "A1", end: "B2" },
      target: "D1",
    });
    assert.equal(badOp.status, 400);
    assert.equal(badOp.body.error.message, "Invalid transfer operation");
    const badSource = await sendJson(base, url, "POST", {
      operation: "copy",
      source: { current: "bogus", end: "B2" },
      target: "D1",
    });
    assert.equal(badSource.status, 400);
    const badTarget = await sendJson(base, url, "POST", {
      operation: "copy",
      source: { current: "A1", end: "B2" },
      target: "A0",
    });
    assert.equal(badTarget.status, 400);
    const after = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    assert.deepEqual(after.sheets[0].cells, { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" });
    assert.deepEqual(after.sheets[0].selection, { current: "A1", end: "A1" });
  });
});
