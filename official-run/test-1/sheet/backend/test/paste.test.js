import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePasteText } from "../src/paste.js";
import { loadData, saveData, getWorkbook, pasteCells } from "../src/store.js";
import { createApp } from "../src/server.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-paste-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("parsePasteText splits tab columns and newline rows, preserving empty fields", () => {
  assert.deepEqual(parsePasteText("East\t1200\nNorth\t800"), [
    ["East", "1200"],
    ["North", "800"],
  ]);
  // empty fields inside the rectangle are preserved
  assert.deepEqual(parsePasteText("a\t\tb\nc"), [
    ["a", "", "b"],
    ["c"],
  ]);
  // a trailing newline does not add an extra empty row
  assert.deepEqual(parsePasteText("a\nb\n"), [["a"], ["b"]]);
  // interior empty rows are preserved
  assert.deepEqual(parsePasteText("a\n\nb"), [["a"], [""], ["b"]]);
  // CRLF and CR line endings are accepted
  assert.deepEqual(parsePasteText("a\tb\r\nc\td"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(parsePasteText("a\rb"), [["a"], ["b"]]);
  assert.deepEqual(parsePasteText(""), [[""]]);
});

async function seed(t) {
  const dir = await tempDir(t);
  process.env.SHALLOW_DATA_DIR = dir;
  return await loadData();
}

test("pasteCells applies the whole rectangle, preserves empty fields and overwrites only the target", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  // put pre-existing content inside the target to prove it is overwritten
  sheet.cells.D1 = "old-d1";
  sheet.cells.E2 = "old-e2";
  sheet.cells.F1 = "keep-f1";
  await saveData(data);
  const result = await pasteCells(wb.id, sheet.id, "D1", "East\t1200\nNorth\t800");
  assert.equal(result.error, undefined);
  const cells = result.workbook.sheets[0].cells;
  assert.equal(cells.D1, "East");
  assert.equal(cells.E1, "1200");
  assert.equal(cells.D2, "North");
  assert.equal(cells.E2, "800");
  assert.equal(cells.F1, "keep-f1"); // outside the target is untouched
  // seeded source range untouched
  assert.equal(cells.A1, "Item");
  assert.equal(cells.B2, "4");
  // selection covers the pasted rectangle
  assert.deepEqual(result.workbook.sheets[0].selection, { current: "D1", end: "E2" });
  assert.equal(result.workbook.sheets[0].activeCell, "D1");
  // other worksheets are unchanged
  assert.deepEqual(result.workbook.sheets[1].cells, {});
});

test("pasteCells clears cells covered by empty fields", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  sheet.cells.D1 = "x";
  sheet.cells.E1 = "y";
  sheet.cells.F1 = "z";
  await saveData(data);
  const result = await pasteCells(wb.id, sheet.id, "D1", "East\t\t1200\nNorth\t800");
  assert.equal(result.error, undefined);
  const cells = result.workbook.sheets[0].cells;
  assert.equal(cells.D1, "East");
  assert.equal(cells.E1, undefined); // empty field clears the cell
  assert.equal(cells.F1, "1200"); // rectangle width 3 (row 2 padded with empty)
  assert.equal(cells.D2, "North");
  assert.equal(cells.E2, "800");
  assert.equal(cells.F2, undefined);
});

test("pasteCells persists after reopening and keeps formulas as raw text", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  await pasteCells(wb.id, wb.sheets[0].id, "D1", "East\t1200\nNorth\t=2+3");
  const reopened = await getWorkbook(wb.id);
  assert.equal(reopened.sheets[0].cells.D1, "East");
  assert.equal(reopened.sheets[0].cells.E1, "1200");
  assert.equal(reopened.sheets[0].cells.D2, "North");
  assert.equal(reopened.sheets[0].cells.E2, "=2+3"); // original formula text stored
  assert.deepEqual(reopened.sheets[0].selection, { current: "D1", end: "E2" });
});

test("pasteCells is atomic: validation failures leave every cell unchanged", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const sheet = wb.sheets[0];
  sheet.cells.D1 = "original";
  await pasteCells(wb.id, sheet.id, "D1", "x"); // persist a value first
  const before = JSON.stringify(await loadData());
  for (const bad of [
    ["not-a-coord", "a\tb"],
    ["A0", "a\tb"],
    ["D1", undefined],
    ["D1", 42],
  ]) {
    const result = await pasteCells(wb.id, sheet.id, bad[0], bad[1]);
    assert.ok(result.error, "expected an error");
    assert.equal(JSON.stringify(await loadData()), before, "state must not change on failure");
  }
  assert.equal(JSON.stringify(await loadData()), before);
  const wbAfter = (await loadData()).workbooks[0];
  assert.equal(wbAfter.sheets[0].cells.D1, "x");
  assert.deepEqual(wbAfter.sheets[0].selection, { current: "D1", end: "D1" });
});

test("pasteCells reports NOT_FOUND for unknown workbook/sheet", async (t) => {
  const data = await seed(t);
  const wb = data.workbooks[0];
  const missingWb = await pasteCells("missing", wb.sheets[0].id, "A1", "a");
  assert.equal(missingWb.error.code, "NOT_FOUND");
  const missingSheet = await pasteCells(wb.id, "missing", "A1", "a");
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

test("POST /paste applies the rectangle and the result persists after reopening", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const wb = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    const sheetId = wb.sheets[0].id;
    const res = await sendJson(base, `/api/workbooks/${id}/sheets/${sheetId}/paste`, "POST", {
      start: "D1",
      text: "East\t1200\nNorth\t800",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.workbook.sheets[0].cells, {
      A1: "Item",
      B1: "Qty",
      A2: "Pen",
      B2: "4",
      D1: "East",
      E1: "1200",
      D2: "North",
      E2: "800",
    });
    assert.deepEqual(res.body.workbook.sheets[0].selection, { current: "D1", end: "E2" });
    const reopened = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    assert.deepEqual(reopened.sheets[0].cells, res.body.workbook.sheets[0].cells);
  });
});

test("POST /paste rejects invalid input with 400 and leaves the seeded state", async (t) => {
  await withServer(t, async (base) => {
    const { body } = await getJson(base, "/api/workbooks");
    const id = body.workbooks[0].id;
    const wb = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    const sheetId = wb.sheets[0].id;
    const url = `/api/workbooks/${id}/sheets/${sheetId}/paste`;
    const bad = await sendJson(base, url, "POST", { start: "bogus", text: "a\tb" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.message, "Invalid cell coordinate");
    const badText = await sendJson(base, url, "POST", { start: "D1", text: 42 });
    assert.equal(badText.status, 400);
    assert.equal(badText.body.error.message, "Invalid paste content");
    const after = (await getJson(base, `/api/workbooks/${id}`)).body.workbook;
    assert.deepEqual(after.sheets[0].cells, { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" });
    assert.deepEqual(after.sheets[0].selection, { current: "A1", end: "A1" });
  });
});
