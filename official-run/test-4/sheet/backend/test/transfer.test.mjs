import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ApiError, createWorkbookService } from "../src/lib/workbooks.mjs";

async function freshService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-transfer-"));
  const service = createWorkbookService(directory);
  return { service, directory };
}

test("copy then paste transfers values and formulas with relative reference adjustment", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, {
      A1: "10",
      B1: "5",
      C1: "=A1+B1",
      D1: "=$A$1+B1",
    });

    const captured = await service.captureClipboard(id, sheetId, "copy", {
      start: "A1",
      end: "D1",
    });
    assert.equal(captured.clipboard.kind, "copy");
    assert.deepEqual(captured.clipboard.range, { start: "A1", end: "D1" });
    // capture never changes the source
    assert.equal(captured.sheets[0].cells.C1, "=A1+B1");

    const pasted = await service.pasteClipboard(id, sheetId, "E1");
    const cells = pasted.sheets[0].cells;
    // target rectangle keeps the two-dimensional layout
    assert.equal(cells.E1, "10");
    assert.equal(cells.F1, "5");
    assert.equal(cells.G1, "=E1+F1"); // relative refs shift with the offset
    assert.equal(cells.H1, "=$A$1+F1"); // absolute $A$1 unchanged, relative B1 -> F1
    // source range is unchanged after copy
    assert.equal(cells.A1, "10");
    assert.equal(cells.C1, "=A1+B1");
    assert.equal(pasted.sheets[0].results.G1, "15");

    // refresh recomputes the adjusted formulas from the persisted text
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.G1, "=E1+F1");
    assert.equal(reloaded.sheets[0].results.G1, "15");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("REQ-4-1-2: copied formulas shift relative refs, keep absolute refs, and persist", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    // evaluation-seed shape: A1=2, B1=3, =A1+B1 at C1, =C1*2 at D1
    await service.updateCells(id, sheetId, {
      A1: "2",
      B1: "3",
      A2: "4",
      B2: "5",
      C1: "=A1+B1",
      C2: "=A2+B2",
      D1: "=$A$1*2",
    });
    let sheet = (await service.get(id)).sheets[0];
    assert.equal(sheet.results.C1, "5");
    assert.equal(sheet.results.C2, "9");
    assert.equal(sheet.results.D1, "4");

    // copy C1:C2 (a two-row formula block) two columns to the right
    await service.captureClipboard(id, sheetId, "copy", { start: "C1", end: "C2" });
    const pasted = await service.pasteClipboard(id, sheetId, "E1");
    sheet = pasted.sheets[0];
    // target formula bar text: relative refs shifted by (+2 columns, +0 rows)
    assert.equal(sheet.cells.E1, "=C1+D1");
    assert.equal(sheet.cells.E2, "=C2+D2");
    // target grid shows results computed from the new references
    assert.equal(sheet.results.E1, "9");
    assert.equal(sheet.results.E2, "9");
    // source formula cells and their results remain unchanged
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.results.C1, "5");
    assert.equal(sheet.cells.C2, "=A2+B2");
    assert.equal(sheet.results.C2, "9");

    // copy D1 (absolute-only formula) down two rows: $A$1 stays, literal 2 stays
    await service.captureClipboard(id, sheetId, "copy", { start: "D1", end: "D1" });
    const absolute = await service.pasteClipboard(id, sheetId, "D3");
    assert.equal(absolute.sheets[0].cells.D3, "=$A$1*2");
    assert.equal(absolute.sheets[0].results.D3, "4");

    // refresh: adjusted formulas and recomputed results persist
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.E1, "=C1+D1");
    assert.equal(reloaded.sheets[0].results.E1, "9");
    assert.equal(reloaded.sheets[0].cells.E2, "=C2+D2");
    assert.equal(reloaded.sheets[0].results.E2, "9");
    assert.equal(reloaded.sheets[0].cells.D3, "=$A$1*2");
    assert.equal(reloaded.sheets[0].results.D3, "4");
    assert.equal(reloaded.sheets[0].cells.C1, "=A1+B1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("REQ-4-1-2: an offset that moves a relative reference out of bounds shows #REF!", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
      E1: "=SUM(A1:B1)",
    });

    // copy C1 (=A1+B1) two columns left: both refs leave the worksheet
    await service.captureClipboard(id, sheetId, "copy", { start: "C1", end: "C1" });
    const pasted = await service.pasteClipboard(id, sheetId, "A1");
    let sheet = pasted.sheets[0];
    // the target formula bar shows the adjusted formula with #REF! tokens
    assert.equal(sheet.cells.A1, "=#REF!+#REF!");
    // the grid displays #REF!
    assert.equal(sheet.results.A1, "#REF!");

    // copy D1 (=C1*2) three columns left: the single ref goes out of bounds
    await service.captureClipboard(id, sheetId, "copy", { start: "D1", end: "D1" });
    const corner = await service.pasteClipboard(id, sheetId, "A1");
    sheet = corner.sheets[0];
    assert.equal(sheet.cells.A1, "=#REF!*2");
    assert.equal(sheet.results.A1, "#REF!");

    // copy an aggregate range formula so an endpoint leaves the worksheet
    await service.captureClipboard(id, sheetId, "copy", { start: "E1", end: "E1" });
    const aggregate = await service.pasteClipboard(id, sheetId, "A1");
    sheet = aggregate.sheets[0];
    assert.equal(sheet.cells.A1, "=SUM(#REF!)");
    assert.equal(sheet.results.A1, "#REF!");

    // the errors and adjusted formulas persist after refresh
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.A1, "=SUM(#REF!)");
    assert.equal(reloaded.sheets[0].results.A1, "#REF!");
    assert.equal(reloaded.sheets[0].cells.C1, "=A1+B1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("copy of a 2x2 range pastes the rectangle without changing cells outside it", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, {
      A1: "Item",
      B1: "Qty",
      A2: "Pen",
      B2: "4",
    });
    await service.captureClipboard(id, sheetId, "copy", { start: "A1", end: "B2" });
    const pasted = await service.pasteClipboard(id, sheetId, "D1");
    const cells = pasted.sheets[0].cells;
    assert.equal(cells.D1, "Item");
    assert.equal(cells.E1, "Qty");
    assert.equal(cells.D2, "Pen");
    assert.equal(cells.E2, "4");
    assert.equal(cells.A1, "Item"); // source unchanged
    assert.equal(cells.A2, "Pen");
    assert.ok(!("F1" in cells)); // cells outside the rectangle untouched
    assert.ok(!("D3" in cells));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cut clears the source only after a successful paste", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, { A1: "East", B1: "1200", A2: "North", B2: "800" });
    const captured = await service.captureClipboard(id, sheetId, "cut", {
      start: "A1",
      end: "B2",
    });
    // cut alone leaves the source intact
    assert.equal(captured.sheets[0].cells.A1, "East");
    assert.equal(captured.sheets[0].cells.B2, "800");

    const pasted = await service.pasteClipboard(id, sheetId, "D1");
    const cells = pasted.sheets[0].cells;
    // target rectangle receives the values
    assert.equal(cells.D1, "East");
    assert.equal(cells.E1, "1200");
    assert.equal(cells.D2, "North");
    assert.equal(cells.E2, "800");
    // source range is cleared after the paste is displayed completely
    assert.equal(cells.A1, "");
    assert.equal(cells.B1, "");
    assert.equal(cells.A2, "");
    assert.equal(cells.B2, "");

    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.A1, "");
    assert.equal(reloaded.sheets[0].cells.D2, "North");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cut then paste to an overlapping target performs a proper move", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, { B1: "x", C1: "y", B2: "z", C2: "w" });
    await service.captureClipboard(id, sheetId, "cut", { start: "B1", end: "C2" });
    const pasted = await service.pasteClipboard(id, sheetId, "C1");
    const cells = pasted.sheets[0].cells;
    assert.equal(cells.C1, "x");
    assert.equal(cells.D1, "y");
    assert.equal(cells.C2, "z");
    assert.equal(cells.D2, "w");
    assert.equal(cells.B1, "");
    assert.equal(cells.B2, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a target validation rule rejects the paste atomically with the exact message", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    const store = JSON.parse(await readFile(join(directory, "workbooks.json"), "utf8"));
    store.workbooks[0].sheets[0].validationRules = [
      { id: "r1", start: "D1", end: "E2", type: "number", min: 0, max: 100 },
    ];
    await writeFile(join(directory, "workbooks.json"), JSON.stringify(store));

    await service.updateCells(id, sheetId, { A1: "East", B1: "1200", A2: "North", B2: "800" });
    await service.captureClipboard(id, sheetId, "copy", { start: "A1", end: "B2" });
    await assert.rejects(
      () => service.pasteClipboard(id, sheetId, "D1"),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Please enter a number from 0 to 100");
        return true;
      },
    );
    // nothing was written: target cells are empty, source is intact, and the
    // rejected operation did not enter the undo history (a single undo still
    // restores the state before the last successful cell write)
    const after = await service.get(id);
    // the rejected paste wrote nothing: D1 stays empty in the seed, E2 stays
    // empty, the source is intact, and the rejected operation did not enter
    // the undo history (a single undo still restores the state before the
    // last successful cell write)
    assert.ok(!("D1" in after.sheets[0].cells));
    assert.ok(!("E2" in after.sheets[0].cells));
    assert.equal(after.sheets[0].cells.A1, "East");
    assert.equal(after.sheets[0].cells.B2, "800");
    const undone = await service.undo(id);
    assert.equal(undone.sheets[0].cells.A2, "East"); // seeded value
    assert.equal(undone.sheets[0].cells.B2, "1200");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cut rejected by validation keeps the source values intact", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    const store = JSON.parse(await readFile(join(directory, "workbooks.json"), "utf8"));
    store.workbooks[0].sheets[0].validationRules = [
      { id: "r1", start: "D1", end: "D1", type: "number", min: 0, max: 100 },
    ];
    await writeFile(join(directory, "workbooks.json"), JSON.stringify(store));

    await service.updateCells(id, sheetId, { A1: "East", B1: "1200" });
    await service.captureClipboard(id, sheetId, "cut", { start: "A1", end: "B1" });
    await assert.rejects(
      () => service.pasteClipboard(id, sheetId, "D1"),
      (error) => {
        assert.equal(error.message, "Please enter a number from 0 to 100");
        return true;
      },
    );
    const after = await service.get(id);
    // neither the source was cleared nor the target written; D1 keeps the
    // seeded (empty) value
    assert.equal(after.sheets[0].cells.A1, "East");
    assert.equal(after.sheets[0].cells.B1, "1200");
    assert.ok(!("D1" in after.sheets[0].cells));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("clipboard is per workbook and paste requires the same worksheet", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;
    const otherSheetId = workbook.sheets[1].id;

    await assert.rejects(() => service.pasteClipboard(id, sheetId, "D1"), (error) => {
      assert.equal(error.message, "Nothing to paste");
      return true;
    });

    await service.captureClipboard(id, sheetId, "copy", { start: "A1", end: "A1" });
    await assert.rejects(
      () => service.pasteClipboard(id, otherSheetId, "D1"),
      (error) => {
        assert.equal(error.message, "Clipboard belongs to another worksheet");
        return true;
      },
    );

    const created = await service.create("Other");
    await assert.rejects(
      () => service.pasteClipboard(created.id, created.activeSheetId, "D1"),
      (error) => {
        assert.equal(error.message, "Nothing to paste");
        return true;
      },
    );
    // capturing in one workbook does not leak into the other
    await service.captureClipboard(created.id, created.activeSheetId, "copy", {
      start: "A1",
      end: "A1",
    });
    assert.equal((await service.get(created.id)).clipboard.kind, "copy");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("undo restores cell edits and redo reapplies them in reverse order", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, { A2: "one" });
    await service.updateCells(id, sheetId, { A2: "two" });
    assert.equal((await service.get(id)).sheets[0].cells.A2, "two");

    const undone = await service.undo(id);
    assert.equal(undone.sheets[0].cells.A2, "one");
    assert.equal(undone.redoAvailable, true);

    const undoneTwice = await service.undo(id);
    assert.equal(undoneTwice.sheets[0].cells.A2, "East"); // seeded value
    assert.equal(undoneTwice.redoAvailable, true);
    assert.equal(undoneTwice.undoAvailable, false);

    const redone = await service.redo(id);
    assert.equal(redone.sheets[0].cells.A2, "one");
    const redoneTwice = await service.redo(id);
    assert.equal(redoneTwice.sheets[0].cells.A2, "two");
    assert.equal(redoneTwice.redoAvailable, false);

    // undo state persists after refresh (fresh read from the store)
    await service.undo(id);
    const reloaded = await service.get(id);
    assert.equal(reloaded.sheets[0].cells.A2, "one");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("undo restores structure changes and pastes", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    // structure op undo
    await service.insertRow(id, sheetId, 3, "above");
    let current = await service.get(id);
    assert.equal(current.sheets[0].cells.A4, "North");
    const structureUndone = await service.undo(id);
    assert.equal(structureUndone.sheets[0].cells.A3, "North");
    assert.equal(structureUndone.sheets[0].cells.A4, "South");

    // paste undo: copy + paste then undo restores the pre-paste grid
    await service.captureClipboard(id, sheetId, "copy", { start: "A2", end: "B2" });
    const pasted = await service.pasteClipboard(id, sheetId, "D1");
    assert.equal(pasted.sheets[0].cells.D1, "East");
    assert.equal(pasted.sheets[0].cells.E1, "1200");
    const pasteUndone = await service.undo(id);
    assert.ok(!("D1" in pasteUndone.sheets[0].cells)); // D1 is empty in the seed
    assert.equal(pasteUndone.sheets[0].cells.A2, "East");

    // multi-cell bulk paste (text) is a single undoable operation
    await service.updateCells(id, sheetId, { D1: "x", E1: "y", F1: "z" });
    const bulkUndone = await service.undo(id);
    assert.ok(!("D1" in bulkUndone.sheets[0].cells)); // D1 is empty in the seed
    assert.ok(!("E1" in bulkUndone.sheets[0].cells));
    assert.ok(!("F1" in bulkUndone.sheets[0].cells));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a new modification after undo disables redo", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const workbook = await service.get(id);
    const sheetId = workbook.activeSheetId;

    await service.updateCells(id, sheetId, { A2: "one" });
    await service.updateCells(id, sheetId, { A2: "two" });
    await service.undo(id);
    assert.equal((await service.get(id)).redoAvailable, true);

    await service.updateCells(id, sheetId, { A2: "branch" });
    const after = await service.get(id);
    assert.equal(after.sheets[0].cells.A2, "branch");
    assert.equal(after.redoAvailable, false);
    await assert.rejects(() => service.redo(id), (error) => {
      assert.equal(error.message, "Nothing to redo");
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("undo in one workbook never modifies another workbook", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    const created = await service.create("Isolated");
    const createdSheet = created.activeSheetId;

    await service.updateCells(created.id, createdSheet, { A1: "edited" });
    await assert.rejects(() => service.undo(id), (error) => {
      assert.equal(error.message, "Nothing to undo");
      return true;
    });
    assert.equal((await service.get(id)).sheets[0].cells.A1, "Region");

    await service.undo(created.id);
    const createdAfter = await service.get(created.id);
    assert.ok(!("A1" in createdAfter.sheets[0].cells));
    // the seeded workbook is untouched
    const seeded = await service.get(id);
    assert.equal(seeded.sheets[0].cells.A1, "Region");
    assert.equal(seeded.undoAvailable, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("undo with no history reports an error and leaves the state unchanged", async () => {
  const { service, directory } = await freshService();
  try {
    const list = await service.list();
    const id = list[0].id;
    await assert.rejects(() => service.undo(id), (error) => {
      assert.equal(error.message, "Nothing to undo");
      return true;
    });
    await assert.rejects(() => service.redo(id), (error) => {
      assert.equal(error.message, "Nothing to redo");
      return true;
    });
    const after = await service.get(id);
    assert.equal(after.sheets[0].cells.A2, "East");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
