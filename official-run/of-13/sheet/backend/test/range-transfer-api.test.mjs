import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

async function putCell(baseUrl, sheetId, address, value) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/cells/${address}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

const WORKBOOK = "wb-q3-sales";
const SHEET1 = "wb-q3-sales-sheet-1";
const SHEET2 = "wb-q3-sales-sheet-2";

const SEED_CELLS = {
  A1: "Region",
  B1: "Sales",
  C1: "Status",
  A2: "East",
  B2: "1200",
  C2: "Open",
  A3: "North",
  B3: "800",
  C3: "Closed",
  A4: "South",
  B4: "700",
  C4: "Open",
};
const SEED_SHEET2_CELLS = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" };

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-range-"));
  const store = createWorkbookStore(directory);
  const handleApi = createApiHandler({ store });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void handleApi(request, response, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  return {
    directory,
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { status: response.status, body };
}

function transfer(baseUrl, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/range-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function openWorkbook(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

/** Copies `A1:B2` onto `D1:E2` — the workflow of the requirement's scenario. */
async function seedAndCopy(api) {
  await api.store.update((state) => {
    const sheet = state.workbooks[0].sheets[0];
    sheet.cells = { A1: "Item/Qty", A2: "Pen/4" };
    return state;
  });
  return transfer(api.baseUrl, SHEET1, {
    source: { start: "A1", end: "B2" },
    target: { start: "D1", end: "E2" },
    mode: "copy",
  });
}

test("copying a rectangle fills the target and leaves the source untouched", async () => {
  const api = await startApi();
  try {
    const result = await seedAndCopy(api);
    assert.equal(result.status, 200);
    const sheet = sheetOf(result.body.workbook, SHEET1);
    assert.deepEqual(sheet.cells, {
      A1: "Item/Qty",
      A2: "Pen/4",
      D1: "Item/Qty",
      D2: "Pen/4",
    });
    assert.deepEqual(sheet.values, { A1: "Item/Qty", A2: "Pen/4", D1: "Item/Qty", D2: "Pen/4" });
    // The whole rectangle is the current selection of that worksheet.
    assert.deepEqual(sheet.selection, { start: "D1", end: "E2" });
    assert.deepEqual(sheetOf(result.body.workbook, SHEET2).cells, SEED_SHEET2_CELLS);

    // A blank field of the source rectangle overwrites its target, not the other cells.
    const reopened = await openWorkbook(api.baseUrl);
    const persisted = sheetOf(reopened.body.workbook, SHEET1);
    assert.equal(persisted.cells.E1, undefined);
    assert.equal(persisted.cells.A1, "Item/Qty");

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).cells, persisted.cells);
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).selection, {
      start: "D1",
      end: "E2",
    });
  } finally {
    await api.close();
  }
});

test("a target rectangle that does not fit changes nothing", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const rejected = await transfer(api.baseUrl, SHEET1, {
      source: { start: "A1", end: "B2" },
      target: { start: "Z1", end: "AA2" },
      mode: "copy",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "The pasted range does not fit in the worksheet");

    const invalid = await transfer(api.baseUrl, SHEET1, {
      source: { start: "nope" },
      target: { start: "D1" },
      mode: "copy",
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "Invalid cell address");

    const unknownMode = await transfer(api.baseUrl, SHEET1, {
      source: { start: "A1" },
      target: { start: "D1" },
      mode: "move",
    });
    assert.equal(unknownMode.status, 400);
    assert.equal(unknownMode.body.error, "Unknown range operation");

    const missingSheet = await transfer(api.baseUrl, "missing", {
      source: { start: "A1" },
      target: { start: "D1" },
      mode: "copy",
    });
    assert.equal(missingSheet.status, 404);
    assert.equal(missingSheet.body.error, "Worksheet not found");

    const wrongMethod = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/range-transfer`,
      { method: "GET" },
    );
    assert.equal(wrongMethod.status, 405);

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await api.close();
  }
});

test("cutting clears the source only once the target holds every value", async () => {
  const api = await startApi();
  try {
    const result = await transfer(api.baseUrl, SHEET1, {
      source: { start: "A1:B2" },
      target: { start: "D1:E2" },
      mode: "cut",
    });
    assert.equal(result.status, 200);
    const sheet = sheetOf(result.body.workbook, SHEET1);
    assert.deepEqual(sheet.cells, {
      A3: "North",
      B3: "800",
      C1: "Status",
      C2: "Open",
      C3: "Closed",
      A4: "South",
      B4: "700",
      C4: "Open",
      D1: "Region",
      E1: "Sales",
      D2: "East",
      E2: "1200",
    });
    // `A3`/`B3` are outside both rectangles and must not move.
    assert.equal(sheet.cells.A3, "North");
    assert.equal(sheet.cells.B3, "800");

    const restarted = await createWorkbookStore(api.directory).read();
    assert.deepEqual(sheetOf(restarted.workbooks[0], SHEET1).cells, sheet.cells);
  } finally {
    await api.close();
  }
});

test("an overlapping cut keeps the original values of the moved rectangle", async () => {
  const api = await startApi();
  try {
    const result = await transfer(api.baseUrl, SHEET1, {
      source: { start: "A1:B2" },
      target: { start: "A2:B3" },
      mode: "cut",
    });
    assert.equal(result.status, 200);
    // Every value is read before anything is written: `A2`/`B2` keep the values that were
    // at `A1`/`B1`, and the vacated source cells disappear instead of shifting further.
    assert.deepEqual(sheetOf(result.body.workbook, SHEET1).cells, {
      A2: "Region",
      B2: "Sales",
      A3: "East",
      B3: "1200",
      C1: "Status",
      C2: "Open",
      C3: "Closed",
      A4: "South",
      B4: "700",
      C4: "Open",
    });
  } finally {
    await api.close();
  }
});

test("copying adjusts relative references and keeps absolute ones", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = state.workbooks[0].sheets[0];
      sheet.cells = { A1: "10", A2: "20", C1: "=$A$1+A2" };
      return state;
    });

    const result = await transfer(api.baseUrl, SHEET1, {
      source: { start: "C1" },
      // one row down and one column right
      target: { start: "D2" },
      mode: "copy",
    });
    assert.equal(result.status, 200);
    const sheet = sheetOf(result.body.workbook, SHEET1);
    assert.equal(sheet.cells.C1, "=$A$1+A2");
    assert.equal(sheet.cells.D2, "=$A$1+B3");
    assert.equal(sheet.values.C1, "30");
    // `D2` evaluates `$A$1 + B3`; B3 is empty, so the result is 10.
    assert.equal(sheet.values.D2, "10");
  } finally {
    await api.close();
  }
});

test("copying the formula chain shifts relative references and keeps the source formula", async () => {
  const api = await startApi();
  try {
    assert.equal((await putCell(api.baseUrl, SHEET2, "A2", "10")).status, 200);
    assert.equal((await putCell(api.baseUrl, SHEET2, "B2", "20")).status, 200);
    assert.equal((await putCell(api.baseUrl, SHEET2, "E1", "=$A$1+B2")).status, 200);

    // One row down: the relative parts move, the `$` parts stay.
    const down = await transfer(api.baseUrl, SHEET2, {
      source: { start: "C1" },
      target: { start: "C2" },
      mode: "copy",
    });
    assert.equal(down.status, 200);
    let sheet = sheetOf(down.body.workbook, SHEET2);
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.values.C1, "5");
    assert.equal(sheet.cells.C2, "=A2+B2");
    assert.equal(sheet.values.C2, "30");

    const absolute = await transfer(api.baseUrl, SHEET2, {
      source: { start: "E1" },
      target: { start: "E2" },
      mode: "copy",
    });
    assert.equal(absolute.status, 200);
    sheet = sheetOf(absolute.body.workbook, SHEET2);
    assert.equal(sheet.cells.E1, "=$A$1+B2");
    assert.equal(sheet.values.E1, "22");
    assert.equal(sheet.cells.E2, "=$A$1+B3");
    assert.equal(sheet.values.E2, "2");

    // The adjusted expression is the formula bar text and survives a reopen and a restart.
    const reopened = await openWorkbook(api.baseUrl);
    assert.equal(sheetOf(reopened.body.workbook, SHEET2).cells.C2, "=A2+B2");
    const restarted = await createWorkbookStore(api.directory).read();
    assert.equal(sheetOf(restarted.workbooks[0], SHEET2).cells.E2, "=$A$1+B3");
  } finally {
    await api.close();
  }
});

test("copying a reference outside the grid shows =#REF! in the formula and #REF! in the grid", async () => {
  const api = await startApi();
  try {
    assert.equal((await putCell(api.baseUrl, SHEET2, "E2", "=A1")).status, 200);
    let sheet = await openWorkbook(api.baseUrl).then((opened) =>
      sheetOf(opened.body.workbook, SHEET2),
    );
    assert.equal(sheet.cells.E2, "=A1");
    assert.equal(sheet.values.E2, "2");

    // Moving the formula up one row would make `A1` become `A0`, so it cannot be preserved.
    const up = await transfer(api.baseUrl, SHEET2, {
      source: { start: "E2" },
      target: { start: "E1" },
      mode: "copy",
    });
    assert.equal(up.status, 200);
    sheet = sheetOf(up.body.workbook, SHEET2);
    assert.equal(sheet.cells.E1, "=#REF!");
    assert.equal(sheet.values.E1, "#REF!");
    // The copied source keeps its own formula and result.
    assert.equal(sheet.cells.E2, "=A1");
    assert.equal(sheet.values.E2, "2");

    const reopened = await openWorkbook(api.baseUrl);
    const persisted = sheetOf(reopened.body.workbook, SHEET2);
    assert.equal(persisted.cells.E1, "=#REF!");
    assert.equal(persisted.values.E1, "#REF!");
  } finally {
    await api.close();
  }
});

test("a rule that rejects a copied value refuses the whole transfer", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = state.workbooks[0].sheets[0];
      sheet.cells = { A1: "150" };
      sheet.validations = [
        {
          id: "v1",
          range: "D1:E2",
          type: "number-range",
          min: 0,
          max: 100,
          message: "Please enter a number from 0 to 100",
        },
      ];
      return state;
    });

    const rejected = await transfer(api.baseUrl, SHEET1, {
      source: { start: "A1" },
      target: { start: "D1" },
      mode: "copy",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    const persisted = await openWorkbook(api.baseUrl);
    const sheet = sheetOf(persisted.body.workbook, SHEET1);
    assert.equal(sheet.cells.A1, "150");
    assert.equal(sheet.cells.D1, undefined);
  } finally {
    await api.close();
  }
});

test("the copy destination is validated against the rules that cover it", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      const sheet = state.workbooks[0].sheets[0];
      sheet.cells = { A1: "42" };
      sheet.validations = [
        { id: "v1", range: "D1:E2", type: "number-range", min: 0, max: 100 },
      ];
      return state;
    });

    const accepted = await transfer(api.baseUrl, SHEET1, {
      source: { start: "A1" },
      target: { start: "D1" },
      mode: "copy",
    });
    assert.equal(accepted.status, 200);
    assert.equal(sheetOf(accepted.body.workbook, SHEET1).cells.D1, "42");
    // The rule range itself is untouched by the transfer.
    assert.equal(sheetOf(accepted.body.workbook, SHEET1).validations[0].range, "D1:E2");
  } finally {
    await api.close();
  }
});

test("the seeded worksheet keeps its own cells when another worksheet is transferred", async () => {
  const api = await startApi();
  try {
    const result = await transfer(api.baseUrl, SHEET2, {
      source: { start: "A1" },
      target: { start: "B2" },
      mode: "copy",
    });
    assert.equal(result.status, 200);
    // The copy lands in the addressed worksheet only; the seeded Sheet1 stays untouched.
    assert.deepEqual(sheetOf(result.body.workbook, SHEET2).cells, {
      ...SEED_SHEET2_CELLS,
      B2: "2",
    });
    assert.deepEqual(sheetOf(result.body.workbook, SHEET1).cells, SEED_CELLS);
  } finally {
    await api.close();
  }
});
