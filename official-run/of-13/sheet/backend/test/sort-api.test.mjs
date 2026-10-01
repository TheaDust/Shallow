/**
 * REQ-5-1-1: sorting the selected rectangle by one of its columns.
 *
 * Only the data rows of the submitted range move (the header row stays on top when it is
 * declared), whole records travel together, formulas keep addressing their own row, and a
 * rejected request leaves the worksheet in its previous order. Filter and validation ranges
 * are not part of the move, so both keep applying to the same rectangle.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiHandler } from "../src/api.mjs";
import { createWorkbookStore } from "../src/store.mjs";

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

/** Column A of the data rows, in grid order: the record order after a sort. */
function regionsOf(sheet) {
  const regions = [];
  for (let row = 2; row <= 6; row += 1) {
    const text = sheet.values[`A${row}`];
    if (text !== undefined) regions.push(text);
  }
  return regions;
}

async function startApi() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
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
  return { status: response.status, body: await response.json() };
}

function openWorkbook(baseUrl) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}`);
}

function sheetOf(workbook, sheetId) {
  return workbook.sheets.find((sheet) => sheet.id === sheetId);
}

function sortCall(baseUrl, sheetId, payload) {
  return callJson(baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${sheetId}/sort`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Fills the first column of `Sheet1` with the keys to compare, header row included. */
async function writeKeys(api, keys) {
  await api.store.update((state) => {
    const sheet = state.workbooks[0].sheets[0];
    sheet.cells = { A1: "Key" };
    keys.forEach((key, index) => {
      sheet.cells[`A${index + 2}`] = key;
    });
    return state;
  });
}

test("ascending and descending sort move whole records and keep the header on top", async () => {
  const api = await startApi();
  try {
    const ascending = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C4",
      column: "B",
      order: "ascending",
      hasHeader: true,
    });
    assert.equal(ascending.status, 200);
    const sorted = sheetOf(ascending.body.workbook, SHEET1);
    assert.deepEqual(regionsOf(sorted), ["South", "North", "East"]);
    // The header row did not take part in the sort and the records moved as a whole.
    assert.equal(sorted.cells.A1, "Region");
    assert.equal(sorted.cells.B1, "Sales");
    assert.equal(sorted.values.B2, "700");
    assert.equal(sorted.values.C2, "Open");
    assert.equal(sorted.values.C3, "Closed");
    assert.equal(sorted.values.B4, "1200");

    const descending = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C4",
      column: "B",
      order: "descending",
      hasHeader: true,
    });
    const back = sheetOf(descending.body.workbook, SHEET1);
    assert.deepEqual(regionsOf(back), ["East", "North", "South"]);
    assert.deepEqual(
      { A2: back.cells.A2, B2: back.cells.B2, C2: back.cells.C2 },
      { A2: "East", B2: "1200", C2: "Open" },
    );

    // Nothing outside the range changed, and the other worksheet is untouched.
    assert.deepEqual(sheetOf(descending.body.workbook, SHEET2).cells, {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });
  } finally {
    await api.close();
  }
});

test("equal sort keys keep their original relative order", async () => {
  const api = await startApi();
  try {
    // East and South share the key `Open`; North is `Closed`.
    const ascending = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C4",
      column: "C",
      order: "ascending",
      hasHeader: true,
    });
    assert.deepEqual(regionsOf(sheetOf(ascending.body.workbook, SHEET1)), [
      "North",
      "East",
      "South",
    ]);

    const descending = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C4",
      column: "C",
      order: "descending",
      hasHeader: true,
    });
    assert.deepEqual(regionsOf(sheetOf(descending.body.workbook, SHEET1)), [
      "East",
      "South",
      "North",
    ]);
  } finally {
    await api.close();
  }
});

test("numbers, dates and text are compared inside their own type and blanks stay last", async () => {
  const api = await startApi();
  try {
    await writeKeys(api, ["2026-03-01", "banana", "10", "2", ""]);

    const ascending = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:A6",
      column: "A",
      order: "ascending",
      hasHeader: true,
    });
    assert.equal(ascending.status, 200);
    const keys = sheetOf(ascending.body.workbook, SHEET1).values;
    assert.deepEqual(
      [keys.A2, keys.A3, keys.A4, keys.A5, keys.A6 ?? ""],
      ["2", "10", "2026-03-01", "banana", ""],
    );

    const descending = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:A6",
      column: "A",
      order: "descending",
      hasHeader: true,
    });
    const reversed = sheetOf(descending.body.workbook, SHEET1).values;
    assert.deepEqual(
      [reversed.A2, reversed.A3, reversed.A4, reversed.A5, reversed.A6 ?? ""],
      ["banana", "2026-03-01", "10", "2", ""],
    );
  } finally {
    await api.close();
  }
});

test("a moved formula keeps addressing its own row", async () => {
  const api = await startApi();
  try {
    await api.store.update((state) => {
      state.workbooks[0].sheets[0].cells.C2 = "=B2+1";
      return state;
    });

    const sorted = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C4",
      column: "B",
      order: "ascending",
      hasHeader: true,
    });
    const sheet = sheetOf(sorted.body.workbook, SHEET1);
    // `East/1200` moved from row 2 to row 4 together with its formula.
    assert.equal(sheet.cells.C4, "=B4+1");
    assert.equal(sheet.values.C4, "1201");
    assert.equal(sheet.cells.B4, "1200");
  } finally {
    await api.close();
  }
});

test("without a header row the first row takes part in the sort", async () => {
  const api = await startApi();
  try {
    const sorted = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C3",
      column: "B",
      order: "ascending",
      hasHeader: false,
    });
    const sheet = sheetOf(sorted.body.workbook, SHEET1);
    // `Sales` is text, so it sorts after the two numbers and lands on the last row.
    assert.deepEqual(
      [sheet.values.A1, sheet.values.A2, sheet.values.A3],
      ["North", "East", "Region"],
    );
    // Row 4 was outside the range and did not move.
    assert.equal(sheet.values.A4, "South");
  } finally {
    await api.close();
  }
});

test("a rejected sort keeps the previous order", async () => {
  const api = await startApi();
  try {
    const before = await openWorkbook(api.baseUrl);
    const cases = [
      { range: "nope", column: "B", order: "ascending" },
      { range: "A1:C4", column: "Z", order: "ascending" },
      { range: "A1:C4", column: "B", order: "sideways" },
      { range: "A1:C4", column: "1", order: "ascending" },
      { range: "A1:C4", column: "B" },
    ];
    for (const payload of cases) {
      const rejected = await sortCall(api.baseUrl, SHEET1, payload);
      assert.equal(rejected.status, 400);
    }

    const missing = await sortCall(api.baseUrl, "nope", {
      range: "A1:C4",
      column: "B",
      order: "ascending",
    });
    assert.equal(missing.status, 404);

    const after = await openWorkbook(api.baseUrl);
    assert.deepEqual(after.body.workbook, before.body.workbook);
    const grid = (await openWorkbook(api.baseUrl)).body.workbook;
    assert.deepEqual(regionsOf(sheetOf(grid, SHEET1)), ["East", "North", "South"]);
  } finally {
    await api.close();
  }
});

test("the sorted order persists and leaves the filter and validation ranges alone", async () => {
  const api = await startApi();
  try {
    await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/filter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filter: {
          range: "A1:C4",
          columns: [{ column: "C", mode: "values", values: ["Open"] }],
        },
      }),
    });
    await callJson(api.baseUrl, `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/validations`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        validations: [{ range: "B2:B4", type: "number-range", min: 0, max: 2000 }],
      }),
    });

    const sorted = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C4",
      column: "B",
      order: "ascending",
      hasHeader: true,
    });
    assert.equal(sorted.status, 200);
    const sheet = sheetOf(sorted.body.workbook, SHEET1);
    assert.deepEqual(regionsOf(sheet), ["South", "North", "East"]);
    // The filter kept its rectangle and now hides the row whose status is `Closed`.
    assert.equal(sheet.filter.range, "A1:C4");
    assert.deepEqual(sheet.filter.columns, [{ column: "C", mode: "values", values: ["Open"] }]);
    assert.deepEqual(sheet.hiddenRows, [3]);
    // The rule still covers B2:B4 and still rejects an out-of-range value.
    assert.equal(sheet.validations.length, 1);
    assert.equal(sheet.validations[0].range, "B2:B4");
    const rejected = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/cells/B2`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "5000" }),
      },
    );
    assert.equal(rejected.status, 400);

    // Reopening the workbook and restarting the store keep the sorted order.
    const reopened = await openWorkbook(api.baseUrl);
    assert.deepEqual(regionsOf(sheetOf(reopened.body.workbook, SHEET1)), [
      "South",
      "North",
      "East",
    ]);
    const restarted = await createWorkbookStore(api.directory).read();
    const stored = restarted.workbooks[0].sheets.find((entry) => entry.id === SHEET1);
    assert.equal(stored.cells.A2, "South");
    assert.equal(stored.cells.A4, "East");
    assert.equal(stored.cells.B2, "700");
  } finally {
    await api.close();
  }
});

test("the sort endpoint only accepts POST", async () => {
  const api = await startApi();
  try {
    const rejected = await callJson(
      api.baseUrl,
      `/api/workbooks/${WORKBOOK}/sheets/${SHEET1}/sort`,
      { method: "GET" },
    );
    assert.equal(rejected.status, 405);
  } finally {
    await api.close();
  }
});

test("sorting a header-only range is a no-op", async () => {
  const api = await startApi();
  try {
    const result = await sortCall(api.baseUrl, SHEET1, {
      range: "A1:C1",
      column: "B",
      order: "ascending",
      hasHeader: true,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(sheetOf(result.body.workbook, SHEET1).cells, SEED_CELLS);
  } finally {
    await api.close();
  }
});
