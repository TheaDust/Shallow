import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NUMBER_ZERO_TO_HUNDRED_MESSAGE } from "../src/lib/validation.mjs";
import { WorkbookError, createWorkbookService } from "../src/lib/workbooks.mjs";

const WORKBOOK = "wb-q3-sales";
const SHEET = "ws-q3-sales-sheet1";

async function createService(t) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-validation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "workbooks.json");
  return { directory, filePath, service: createWorkbookService({ filePath }) };
}

function sheetOf(workbook, index = 0) {
  return workbook.worksheets[index];
}

async function valueOf(service, name) {
  return sheetOf(await service.get(WORKBOOK)).cells[name]?.value ?? "";
}

test("REQ-5-2-1 stores a dropdown rule with trimmed values and enforces it", async (t) => {
  const { filePath, service } = await createService(t);

  const saved = await service.setValidation(WORKBOOK, SHEET, {
    range: "C2:C4",
    type: "list",
    values: ["  Open ", "Closed"],
  });
  assert.deepEqual(sheetOf(saved).validations, [
    { range: "C2:C4", type: "list", values: ["Open", "Closed"] },
  ]);

  const accepted = await service.writeCells(WORKBOOK, SHEET, {
    updates: [{ name: "C3", input: "Open" }],
  });
  assert.equal(sheetOf(accepted).cells.C3.value, "Open", "an allowed value is stored");

  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "C2", input: "Pending" }] }),
    (error) => error instanceof WorkbookError
      && error.message === "Please select one of the following values: Open, Closed",
  );
  assert.equal(await valueOf(service, "C2"), "Open", "the rejected cell keeps its value");

  // The rule survives a reopen and still rejects.
  const reopened = createWorkbookService({ filePath });
  assert.deepEqual(sheetOf(await reopened.get(WORKBOOK)).validations, [
    { range: "C2:C4", type: "list", values: ["Open", "Closed"] },
  ]);
  await assert.rejects(
    () => reopened.writeCells(WORKBOOK, SHEET, { updates: [{ name: "C4", input: "nope" }] }),
    (error) => error instanceof WorkbookError,
  );
  assert.equal(await valueOf(reopened, "C4"), "Open");
});

test("REQ-5-2-1 an inclusive number rule rejects 101 with the 0-to-100 message", async (t) => {
  const { filePath, service } = await createService(t);

  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: "0", max: "100" });
  assert.deepEqual(sheetOf(await service.get(WORKBOOK)).validations, [
    { range: "B2:B3", type: "number", min: 0, max: 100 },
  ]);

  // Both boundaries are inclusive and existing valid values stay untouched.
  const lower = await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B2", input: "0" }] });
  assert.equal(sheetOf(lower).cells.B2.value, "0");
  const upper = await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "100" }] });
  assert.equal(sheetOf(upper).cells.B3.value, "100");

  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "101" }] }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );
  assert.equal(await valueOf(service, "B3"), "100");

  // A different range uses its own wording.
  const custom = await service.setValidation(WORKBOOK, SHEET, {
    range: "E1:E1",
    type: "number",
    min: 5,
    max: 10,
  });
  assert.deepEqual(sheetOf(custom).validations[1], { range: "E1:E1", type: "number", min: 5, max: 10 });
  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "E1", input: "11" }] }),
    (error) => error instanceof WorkbookError
      && error.message === "Please enter a number between 5 and 10",
  );

  const reloaded = createWorkbookService({ filePath });
  await assert.rejects(
    () => reloaded.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "101" }] }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );
});

test("REQ-5-2-1 a bulk write is rejected as a whole when any target breaks the rule", async (t) => {
  const { service } = await createService(t);
  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: 0, max: 100 });

  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, {
      updates: [
        { name: "B2", input: "50" },
        { name: "B3", input: "101" },
      ],
    }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );
  assert.equal(await valueOf(service, "B2"), "1200", "the first target keeps its original value");
  assert.equal(await valueOf(service, "B3"), "800");

  // A range move whose target breaks the rule leaves both ranges untouched.
  await service.setValidation(WORKBOOK, SHEET, { range: "E1:E2", type: "number", min: 0, max: 100 });
  await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "E1", input: "50" }] });
  await assert.rejects(
    () => service.transferRange(WORKBOOK, SHEET, {
      mode: "copy",
      source: { anchor: "A1", focus: "B2" },
      target: { anchor: "D1", focus: "E2" },
    }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );
  const sheet = sheetOf(await service.get(WORKBOOK));
  assert.equal(sheet.cells.D1, undefined, "the rejected move writes no target cell");
  assert.equal(sheet.cells.A1.value, "Region");
  assert.equal(sheet.cells.E1.value, "50");
});

test("REQ-5-2-1 deletes a rule and re-applies a modified one to the new range", async (t) => {
  const { service } = await createService(t);
  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: 0, max: 100 });

  // Saving the same range with new parameters replaces the rule immediately.
  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: 0, max: 1000 });
  assert.deepEqual(sheetOf(await service.get(WORKBOOK)).validations, [
    { range: "B2:B3", type: "number", min: 0, max: 1000 },
  ]);
  const allowed = await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "900" }] });
  assert.equal(sheetOf(allowed).cells.B3.value, "900");

  // Deleting removes the constraint without rewriting any value.
  const deleted = await service.deleteValidation(WORKBOOK, SHEET, "B2:B3");
  assert.equal(sheetOf(deleted).validations, undefined);
  const afterDelete = await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "5000" }] });
  assert.equal(sheetOf(afterDelete).cells.B3.value, "5000");
  assert.equal(sheetOf(afterDelete).cells.A2.value, "East");
});

test("REQ-5-2-1 rules follow the cells when rows and columns move", async (t) => {
  const { service } = await createService(t);
  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: 0, max: 100 });

  const shifted = await service.structure(WORKBOOK, SHEET, {
    axis: "row",
    action: "insert-above",
    index: 1,
  });
  assert.deepEqual(sheetOf(shifted).validations, [{ range: "B3:B4", type: "number", min: 0, max: 100 }]);
  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B4", input: "101" }] }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );
  const moved = await service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "50" }] });
  assert.equal(sheetOf(moved).cells.B3.value, "50", "the shifted cell is still constrained and accepts 50");
  await assert.rejects(
    () => service.writeCells(WORKBOOK, SHEET, { updates: [{ name: "B3", input: "101" }] }),
    (error) => error instanceof WorkbookError && error.message === NUMBER_ZERO_TO_HUNDRED_MESSAGE,
  );

  const columnShifted = await service.structure(WORKBOOK, SHEET, {
    axis: "column",
    action: "insert-left",
    index: 1,
  });
  assert.deepEqual(sheetOf(columnShifted).validations, [{ range: "C3:C4", type: "number", min: 0, max: 100 }]);
});

test("REQ-5-2-1 rejects invalid payloads without changing the stored rules", async (t) => {
  const { service } = await createService(t);
  await service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: 0, max: 100 });

  await assert.rejects(
    () => service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "list", values: ["  ", ""] }),
    (error) => error instanceof WorkbookError,
  );
  await assert.rejects(
    () => service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "number", min: 100, max: 0 }),
    (error) => error instanceof WorkbookError,
  );
  await assert.rejects(
    () => service.setValidation(WORKBOOK, SHEET, { range: "B2:B3", type: "unknown" }),
    (error) => error instanceof WorkbookError,
  );
  assert.deepEqual(sheetOf(await service.get(WORKBOOK)).validations, [
    { range: "B2:B3", type: "number", min: 0, max: 100 },
  ]);
});
