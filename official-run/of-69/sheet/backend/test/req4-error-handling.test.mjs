import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkbookService } from "../src/lib/workbooks.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET1 = "ws-q3-sales-sheet1";

async function createService(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-req4-errors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "workbooks.json");
}

function cellOf(workbook, name) {
  return workbook.worksheets.find((worksheet) => worksheet.id === SHEET1)?.cells[name];
}

const valueAt = (workbook, name) => cellOf(workbook, name)?.value;
const formulaAt = (workbook, name) => cellOf(workbook, name)?.formula;

// REQ-4-2-2: every error kind uses its stable visible value and the submitted formula is kept,
// including through a fresh service (refresh). Circular references are reported as #REF!.
test("REQ-4-2-2 shows a stable error value per kind and keeps the original formula after refresh", async (t) => {
  const filePath = await createService(t);
  const service = createWorkbookService({ filePath });
  const updated = await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "=1/0" },
      { name: "B1", input: "=NOSUCH(1)" },
      { name: "C1", input: "=1+" },
      { name: "D1", input: "=A1+1" },
      { name: "E1", input: "=E1" },
      { name: "F1", input: "=G1" },
      { name: "G1", input: "=F1" },
      { name: "H1", input: "=ZZ1" },
      { name: "I1", input: "ok" },
    ],
  });

  assert.equal(valueAt(updated, "A1"), "#DIV/0!", "division by zero");
  assert.equal(valueAt(updated, "B1"), "#NAME?", "unsupported function");
  assert.equal(valueAt(updated, "C1"), "#ERROR!", "malformed expression");
  assert.equal(valueAt(updated, "D1"), "#DIV/0!", "an error propagates along its dependency chain");
  assert.equal(valueAt(updated, "E1"), "#REF!", "a direct circular reference");
  assert.equal(valueAt(updated, "F1"), "#REF!", "an indirect circular reference");
  assert.equal(valueAt(updated, "G1"), "#REF!");
  assert.equal(valueAt(updated, "H1"), "#REF!", "a reference outside the worksheet");
  assert.equal(valueAt(updated, "I1"), "ok", "an unrelated cell is unaffected");

  assert.equal(formulaAt(updated, "A1"), "=1/0", "the formula bar keeps the submitted expression");
  assert.equal(formulaAt(updated, "B1"), "=NOSUCH(1)");
  assert.equal(formulaAt(updated, "C1"), "=1+");
  assert.equal(formulaAt(updated, "E1"), "=E1");

  const reopened = createWorkbookService({ filePath });
  const reloaded = await reopened.get(WORKBOOK);
  assert.equal(valueAt(reloaded, "A1"), "#DIV/0!");
  assert.equal(formulaAt(reloaded, "A1"), "=1/0");
  assert.equal(valueAt(reloaded, "B1"), "#NAME?");
  assert.equal(valueAt(reloaded, "C1"), "#ERROR!");
  assert.equal(valueAt(reloaded, "E1"), "#REF!");
  assert.equal(formulaAt(reloaded, "F1"), "=G1");
  assert.equal(valueAt(reloaded, "I1"), "ok");
});

// REQ-4-2-2: an error cell does not block editing or recalculating unrelated cells.
test("REQ-4-2-2 keeps unrelated cells editable and recalculating around an error", async (t) => {
  const filePath = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "=1/0" },
      { name: "B1", input: "=A1+1" },
      { name: "C1", input: "3" },
      { name: "D1", input: "=C1*2" },
      { name: "E1", input: "ok" },
    ],
  });

  const edited = await service.writeCells(WORKBOOK, SHEET1, { updates: [{ name: "C1", input: "4" }] });
  assert.equal(valueAt(edited, "D1"), "8", "a formula unrelated to the error still recalculates");
  assert.equal(valueAt(edited, "A1"), "#DIV/0!", "the error cell is unchanged by another edit");
  assert.equal(valueAt(edited, "B1"), "#DIV/0!");
  assert.equal(valueAt(edited, "E1"), "ok");

  const later = await service.writeCells(WORKBOOK, SHEET1, { updates: [{ name: "E1", input: "changed" }] });
  assert.equal(valueAt(later, "E1"), "changed", "editing beside an error cell succeeds");
  assert.equal(valueAt(later, "D1"), "8");
});

// REQ-4-2-2: replacing an error with a valid formula shows the new result, updates dependents,
// and the error no longer appears after refresh.
test("REQ-4-2-2 fixes an error formula and updates dependents across a reopen", async (t) => {
  const filePath = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "=A1/0" },
      { name: "C1", input: "=B1+1" },
    ],
  });
  assert.equal(valueAt(await service.get(WORKBOOK), "B1"), "#DIV/0!");
  assert.equal(valueAt(await service.get(WORKBOOK), "C1"), "#DIV/0!", "the dependent shows the error");

  const fixed = await service.writeCells(WORKBOOK, SHEET1, { updates: [{ name: "B1", input: "=A1*10" }] });
  assert.equal(valueAt(fixed, "B1"), "20", "the grid shows the new result");
  assert.equal(formulaAt(fixed, "B1"), "=A1*10", "the formula bar shows the new formula");
  assert.equal(valueAt(fixed, "C1"), "21", "the dependent recalculates");

  const reopened = await createWorkbookService({ filePath }).get(WORKBOOK);
  assert.equal(valueAt(reopened, "B1"), "20");
  assert.equal(formulaAt(reopened, "B1"), "=A1*10");
  assert.equal(valueAt(reopened, "C1"), "21", "the error no longer appears after refresh");
});

// REQ-4-1-2: copying a formula adjusts relative references, keeps absolute ones and the source.
test("REQ-4-1-2 adjusts copied references, keeps absolute ones and persists the source", async (t) => {
  const filePath = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "A2", input: "5" },
      { name: "B1", input: "3" },
      { name: "B2", input: "7" },
      { name: "C1", input: "=A1+B1" },
      { name: "D1", input: "=A1+$B$1" },
    ],
  });

  const moved = await service.transferRange(WORKBOOK, SHEET1, {
    mode: "copy",
    source: { anchor: "C1", focus: "D1" },
    target: { anchor: "C2", focus: "D2" },
  });
  assert.equal(formulaAt(moved, "C1"), "=A1+B1", "the source formula is untouched");
  assert.equal(valueAt(moved, "C1"), "5", "the source result is unchanged");
  assert.equal(formulaAt(moved, "C2"), "=A2+B2", "relative references follow the target offset");
  assert.equal(valueAt(moved, "C2"), "12", "the target grid shows the new result");
  assert.equal(formulaAt(moved, "D2"), "=A2+$B$1", "absolute references stay anchored");
  assert.equal(valueAt(moved, "D2"), "8");

  const reopened = await createWorkbookService({ filePath }).get(WORKBOOK);
  assert.equal(formulaAt(reopened, "C2"), "=A2+B2");
  assert.equal(valueAt(reopened, "C2"), "12");
  assert.equal(formulaAt(reopened, "D2"), "=A2+$B$1");
});

// REQ-4-1-2: an offset that drives a relative reference off the sheet makes the whole
// target formula `=#REF!` (grid `#REF!`), while the source keeps its formula and result.
test("REQ-4-1-2 shows =#REF! when a copied relative reference leaves the worksheet", async (t) => {
  const filePath = await createService(t);
  const service = createWorkbookService({ filePath });
  await service.writeCells(WORKBOOK, SHEET1, {
    updates: [
      { name: "A1", input: "2" },
      { name: "B1", input: "3" },
      { name: "D1", input: "=A1+B1" },
    ],
  });

  const moved = await service.transferRange(WORKBOOK, SHEET1, {
    mode: "copy",
    source: { anchor: "D1", focus: "D1" },
    target: { anchor: "C1", focus: "C1" },
  });
  assert.equal(formulaAt(moved, "C1"), "=#REF!", "the target formula bar shows =#REF!");
  assert.equal(valueAt(moved, "C1"), "#REF!", "the target grid shows #REF!");
  assert.equal(formulaAt(moved, "D1"), "=A1+B1", "the source formula is unchanged");
  assert.equal(valueAt(moved, "D1"), "5", "the source result is unchanged");

  const reopened = await createWorkbookService({ filePath }).get(WORKBOOK);
  assert.equal(formulaAt(reopened, "C1"), "=#REF!");
  assert.equal(valueAt(reopened, "C1"), "#REF!");
  assert.equal(valueAt(reopened, "D1"), "5");
});
