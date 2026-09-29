/**
 * REQ-4-1-1 / REQ-4-2-2 through the real HTTP write path.
 *
 * The formula engine itself is covered by `formula.test.mjs`; these tests drive
 * the public `POST .../worksheets/:wsId/cells` route of the seeded workbook so
 * the stored raw text, the derived display values, the error isolation and the
 * persistence of an expression (or of an error) are checked end to end.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${WORKBOOK}/worksheets/ws-q3-sheet1`;

function sheetOf(workbook, id = "ws-q3-sheet1") {
  return workbook.worksheets.find((sheet) => sheet.id === id);
}

/** One commit through the public cell route of REQ-3-1-1. */
function write(baseUrl, updates, worksheetId = "ws-q3-sheet1") {
  return request(baseUrl, `${WORKBOOK}/worksheets/${worksheetId}/cells`, {
    method: "POST",
    body: JSON.stringify({ updates }),
  });
}

async function readWorkbook(baseUrl) {
  const response = await request(baseUrl, WORKBOOK);
  assert.equal(response.status, 200);
  return response.body.workbook;
}

test("REQ-4-1-1: expression chain entered through the cell route shows results and persists", async () => {
  const app = await startApp();
  try {
    // The declared A1/B1/`=A1+B1`/`=C1*2` state is reached through the public
    // write path, because A1 is already the established `Region` header.
    const written = await write(app.baseUrl, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
    assert.equal(written.status, 200);
    const sheet = sheetOf(written.body.workbook);
    assert.equal(sheet.cells.A1, "2");
    assert.equal(sheet.cells.B1, "3");
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.cells.D1, "=C1*2");
    assert.equal(sheet.values.A1, "2");
    assert.equal(sheet.values.B1, "3");
    assert.equal(sheet.values.C1, "5");
    assert.equal(sheet.values.D1, "10");

    // Refreshing reads the stored expression and recomputes the same result.
    const reopened = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(reopened.cells.C1, "=A1+B1");
    assert.equal(reopened.values.C1, "5");
    assert.equal(reopened.values.D1, "10");

    const persisted = await createJsonStore(app.storePath, createSeedState()).read();
    assert.equal(sheetOf(persisted.workbooks[0]).cells.D1, "=C1*2");
  } finally {
    await app.close();
  }
});

test("REQ-4-1-1: aggregate functions ignore blanks/text, COUNT counts numbers, names are case-insensitive", async () => {
  const app = await startApp();
  try {
    const written = await write(app.baseUrl, {
      A1: "10",
      A2: "text",
      A3: "",
      A4: "20",
      B1: "=SUM(A1:A4)",
      B2: "=AVERAGE(A1:A4)",
      B3: "=COUNT(A1:A4)",
      B4: "=MIN(A1:A4)",
      B5: "=MAX(A1:A4)",
      B6: "=sum(a1:a4)",
      C1: "=SUM(A1:A2)",
    });
    assert.equal(written.status, 200);
    const sheet = sheetOf(written.body.workbook);
    assert.equal(sheet.values.B1, "30");
    assert.equal(sheet.values.B2, "15");
    assert.equal(sheet.values.B3, "2");
    assert.equal(sheet.values.B4, "10");
    assert.equal(sheet.values.B5, "20");
    assert.equal(sheet.values.B6, "30");
    // A range without numeric cells is not treated as zeros.
    assert.equal(sheet.values.C1, "10");
    assert.equal(sheet.cells.B6, "=sum(a1:a4)");
    assert.equal(sheet.values.A3, undefined);

    const reopened = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(reopened.values.B1, "30");
    assert.equal(reopened.values.B6, "30");
  } finally {
    await app.close();
  }
});

test("REQ-4-1-1: constants, parentheses and the four operators evaluate through the write path", async () => {
  const app = await startApp();
  try {
    const written = await write(app.baseUrl, {
      A1: "4",
      B1: "2",
      C1: "=1+2*3",
      C2: "=(1+2)*3",
      C3: "=A1-B1",
      C4: "=A1*B1",
      C5: "=A1/B1",
      C6: "=-B1+1",
    });
    const sheet = sheetOf(written.body.workbook);
    assert.equal(sheet.values.C1, "7");
    assert.equal(sheet.values.C2, "9");
    assert.equal(sheet.values.C3, "2");
    assert.equal(sheet.values.C4, "8");
    assert.equal(sheet.values.C5, "2");
    assert.equal(sheet.values.C6, "-1");
  } finally {
    await app.close();
  }
});

test("REQ-4-2-2: each error keeps its stable value, its expression and its isolation", async () => {
  const app = await startApp();
  try {
    const written = await write(app.baseUrl, {
      A1: "0",
      B1: "=10/A1",
      B2: "=ZZ1",
      B3: "=NOPE(1)",
      B4: "=1+",
      B5: "=C5",
      C5: "=B5",
      D1: "=1+1",
    });
    assert.equal(written.status, 200);
    const sheet = sheetOf(written.body.workbook);
    assert.equal(sheet.values.B1, "#DIV/0!");
    assert.equal(sheet.values.B2, "#REF!");
    assert.equal(sheet.values.B3, "#NAME?");
    assert.equal(sheet.values.B4, "#ERROR!");
    assert.equal(sheet.values.B5, "#REF!");
    assert.equal(sheet.values.C5, "#REF!");
    // Every error cell keeps the expression the user submitted.
    assert.equal(sheet.cells.B1, "=10/A1");
    assert.equal(sheet.cells.B2, "=ZZ1");
    assert.equal(sheet.cells.B4, "=1+");
    assert.equal(sheet.cells.B5, "=C5");
    // An error does not block or change unrelated cells.
    assert.equal(sheet.values.D1, "2");
    assert.equal(sheet.values.A1, "0");

    // Editing another cell while the errors stand still succeeds.
    const edited = await write(app.baseUrl, { A2: "North", E1: "=D1*5" });
    assert.equal(edited.status, 200);
    const editedSheet = sheetOf(edited.body.workbook);
    assert.equal(editedSheet.values.A2, "North");
    assert.equal(editedSheet.values.E1, "10");
    assert.equal(editedSheet.values.B1, "#DIV/0!");

    // Error values and the original formulas survive a refresh and a restart.
    const reopened = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(reopened.values.B1, "#DIV/0!");
    assert.equal(reopened.values.B2, "#REF!");
    assert.equal(reopened.values.B3, "#NAME?");
    assert.equal(reopened.values.B4, "#ERROR!");
    assert.equal(reopened.values.B5, "#REF!");
    assert.equal(reopened.cells.B1, "=10/A1");
    assert.equal(reopened.cells.B5, "=C5");

    const persisted = await createJsonStore(app.storePath, createSeedState()).read();
    const storedSheet = sheetOf(persisted.workbooks[0]);
    assert.equal(storedSheet.cells.B1, "=10/A1");
    assert.equal(storedSheet.cells.B4, "=1+");
  } finally {
    await app.close();
  }
});

test("REQ-4-2-2: a corrected formula replaces the error and updates dependents", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { A1: "0", B1: "=1/A1", D1: "=B1*2" });
    const broken = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(broken.values.B1, "#DIV/0!");
    assert.equal(broken.values.D1, "#DIV/0!");

    // A corrected source value clears the error of the dependent formula.
    const sourced = await write(app.baseUrl, { A1: "4" });
    assert.equal(sheetOf(sourced.body.workbook).values.B1, "0.25");
    assert.equal(sheetOf(sourced.body.workbook).values.D1, "0.5");

    // Replacing the expression with a valid one shows the new result.
    const fixed = await write(app.baseUrl, { B1: "=A1+1" });
    const fixedSheet = sheetOf(fixed.body.workbook);
    assert.equal(fixedSheet.cells.B1, "=A1+1");
    assert.equal(fixedSheet.values.B1, "5");
    assert.equal(fixedSheet.values.D1, "10");

    const reopened = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(reopened.values.B1, "5");
    assert.equal(reopened.values.D1, "10");
    assert.equal(reopened.cells.B1, "=A1+1");
    assert.ok(!Object.values(reopened.values).includes("#DIV/0!"));
  } finally {
    await app.close();
  }
});

test("REQ-4-2-2: a rejected write keeps the error cell and the last successful formula", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { B1: "=1/0", C1: "=1+1" });
    const before = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(before.values.B1, "#DIV/0!");

    const rejected = await write(app.baseUrl, { B1: "=1+2", "not an address": "x" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Invalid cell address");

    const after = sheetOf(await readWorkbook(app.baseUrl));
    assert.equal(after.cells.B1, "=1/0");
    assert.equal(after.values.B1, "#DIV/0!");
    assert.equal(after.values.C1, "2");
  } finally {
    await app.close();
  }
});
