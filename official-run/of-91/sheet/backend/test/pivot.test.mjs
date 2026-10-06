import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/store/workbooks.mjs";

const DETAIL = `/api/workbooks/${SEED_WORKBOOK_ID}`;
const SOURCE = `${DETAIL}/worksheets/${SEED_WORKSHEET_ID}`;
const FIELD_MISSING = "Pivot field is no longer available. Select a new field.";
const NUMERIC_MESSAGE = "Value field requires numeric values";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-pivot-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-pivot-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html>", "utf8");
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  let server;
  const app = {
    dataDir,
    staticRoot,
    baseUrl: "",
    async listen() {
      server = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => server.listen(0, "127.0.0.1", done));
      app.baseUrl = `http://127.0.0.1:${server.address().port}`;
      return app.baseUrl;
    },
    async stop() {
      if (!server) return;
      const closing = server;
      server = undefined;
      await new Promise((done) => closing.close(done));
    },
    async restart() {
      await app.stop();
      return app.listen();
    },
  };
  await app.listen();
  return app;
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(baseUrl, method, path, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function worksheetNamed(workbook, name) {
  return workbook.worksheets.find((worksheet) => worksheet.name === name);
}

function sourceOf(workbook) {
  return workbook.worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID);
}

/** Creates the pivot table of the seeded `A1:C4` source range; returns the pivot worksheet. */
async function createPivot(app) {
  const created = await send(app.baseUrl, "POST", `${SOURCE}/pivot`, { range: "A1:C4" });
  assert.equal(created.status, 201);
  const pivot = worksheetNamed(created.body.workbook, "Pivot1");
  assert.ok(pivot, JSON.stringify(created.body.workbook.worksheets.map((worksheet) => worksheet.name)));
  return { workbook: created.body.workbook, pivot };
}

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

test("creating a pivot table adds a Pivot1 worksheet that only reads the source range", async () => {
  const app = await startApp();
  try {
    const { workbook, pivot } = await createPivot(app);
    // The first header groups the rows, the first numeric header is summed.
    assert.deepEqual(pivot.cells, {
      A1: "Region",
      B1: "SUM of Sales",
      A2: "East",
      B2: "1200",
      A3: "North",
      B3: "800",
      A4: "South",
      B4: "700",
      A5: "Grand Total",
      B5: "2700",
    });
    assert.deepEqual(pivot.pivot, {
      sourceWorksheetId: SEED_WORKSHEET_ID,
      range: "A1:C4",
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    // The result worksheet becomes active and the source records are untouched.
    assert.equal(workbook.activeWorksheetId, pivot.id);
    assert.deepEqual(sourceOf(workbook).cells, SEED_CELLS);

    await app.restart();
    const reopened = (await json(app.baseUrl, DETAIL)).body.workbook;
    assert.deepEqual(worksheetNamed(reopened, "Pivot1").cells, pivot.cells);
    assert.deepEqual(worksheetNamed(reopened, "Pivot1").pivot, pivot.pivot);
    assert.equal(reopened.activeWorksheetId, pivot.id);
    assert.deepEqual(sourceOf(reopened).cells, SEED_CELLS);
  } finally {
    await app.stop();
  }
});

test("a second pivot table takes the next name and switching back keeps the source data", async () => {
  const app = await startApp();
  try {
    await createPivot(app);
    const second = await send(app.baseUrl, "POST", `${SOURCE}/pivot`, { range: "A1:C4" });
    assert.equal(second.status, 201);
    assert.ok(worksheetNamed(second.body.workbook, "Pivot2"));

    // Switching to the source worksheet shows the original values and order.
    const switched = await send(app.baseUrl, "PATCH", DETAIL, { activeWorksheetId: SEED_WORKSHEET_ID });
    assert.equal(switched.status, 200);
    assert.deepEqual(sourceOf(switched.body.workbook).cells, SEED_CELLS);
    assert.deepEqual(worksheetNamed(switched.body.workbook, "Pivot1").cells.A2, "East");
  } finally {
    await app.stop();
  }
});

test("COUNT counts non-empty records and AVERAGE averages parseable numbers", async () => {
  const app = await startApp();
  try {
    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;

    const counted = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "COUNT",
    });
    assert.equal(counted.status, 200);
    const countedPivot = worksheetNamed(counted.body.workbook, "Pivot1");
    assert.equal(countedPivot.cells.B1, "COUNT of Sales");
    assert.deepEqual(
      ["B2", "B3", "B4", "B5"].map((coordinate) => countedPivot.cells[coordinate]),
      ["1", "1", "1", "3"],
    );

    const averaged = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "AVERAGE",
    });
    assert.equal(averaged.status, 200);
    const averagedPivot = worksheetNamed(averaged.body.workbook, "Pivot1");
    assert.equal(averagedPivot.cells.B1, "AVERAGE of Sales");
    assert.deepEqual(
      ["B2", "B3", "B4", "B5"].map((coordinate) => averagedPivot.cells[coordinate]),
      ["1200", "800", "700", "900"],
    );

    // COUNT accepts non-numeric content, SUM and AVERAGE only add numbers.
    await send(app.baseUrl, "PATCH", `${SOURCE}/cells`, { coordinate: "B4", value: "n/a" });
    const countedAgain = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "COUNT",
    });
    assert.equal(countedAgain.status, 200);
    assert.equal(worksheetNamed(countedAgain.body.workbook, "Pivot1").cells.B5, "3");
    const summed = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    assert.equal(summed.status, 200);
    assert.equal(worksheetNamed(summed.body.workbook, "Pivot1").cells.B5, "2000");
    const averageRefresh = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "AVERAGE",
    });
    assert.equal(averageRefresh.status, 200);
    assert.equal(worksheetNamed(averageRefresh.body.workbook, "Pivot1").cells.B5, "1000");
    // Refreshing keeps the stored method and reads the current source values.
    const refreshed = await send(app.baseUrl, "POST", `${base}/refresh`);
    assert.equal(refreshed.status, 200);
    assert.equal(worksheetNamed(refreshed.body.workbook, "Pivot1").cells.B5, "1000");
  } finally {
    await app.stop();
  }
});

test("a column field orders its values, closes with Grand Total and fills missing combinations", async () => {
  const app = await startApp();
  try {
    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;

    const counted = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "Status",
      valueField: "Sales",
      summarizeBy: "COUNT",
    });
    assert.equal(counted.status, 200);
    assert.deepEqual(worksheetNamed(counted.body.workbook, "Pivot1").cells, {
      A1: "Region",
      B1: "Open",
      C1: "Closed",
      D1: "Grand Total",
      A2: "East",
      B2: "1",
      C2: "0",
      D2: "1",
      A3: "North",
      B3: "0",
      C3: "1",
      D3: "1",
      A4: "South",
      B4: "1",
      C4: "0",
      D4: "1",
      A5: "Grand Total",
      B5: "2",
      C5: "1",
      D5: "3",
    });

    const summed = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "Status",
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    assert.equal(summed.status, 200);
    const cells = worksheetNamed(summed.body.workbook, "Pivot1").cells;
    assert.deepEqual(
      ["B2", "C2", "D2", "B3", "C3", "D3", "B4", "C4", "D4", "B5", "C5", "D5"].map(
        (coordinate) => cells[coordinate],
      ),
      ["1200", "0", "1200", "0", "800", "800", "700", "0", "700", "1900", "800", "2700"],
    );
    assert.deepEqual(sourceOf(summed.body.workbook).cells, SEED_CELLS);
  } finally {
    await app.stop();
  }
});

test("refresh replaces the summary with the current source data and never edits the source", async () => {
  const app = await startApp();
  try {
    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;
    await send(app.baseUrl, "PATCH", `${SOURCE}/cells`, { coordinate: "B2", value: "1500" });

    const refreshed = await send(app.baseUrl, "POST", `${base}/refresh`);
    assert.equal(refreshed.status, 200);
    const cells = worksheetNamed(refreshed.body.workbook, "Pivot1").cells;
    assert.equal(cells.B2, "1500");
    assert.equal(cells.B5, "3000");
    const source = sourceOf(refreshed.body.workbook);
    assert.equal(source.cells.B2, "1500");
    assert.equal(source.cells.A2, "East");
    assert.deepEqual(Object.keys(source.cells), Object.keys(SEED_CELLS));
  } finally {
    await app.stop();
  }
});

test("a deleted source header makes refresh fail with the required message and keeps both worksheets", async () => {
  const app = await startApp();
  try {
    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;
    const before = pivot.cells;

    // Deleting the sales column also moves the pivot's stored source range.
    const deleted = await send(app.baseUrl, "POST", `${SOURCE}/structure`, {
      axis: "column",
      mode: "delete",
      index: 2,
    });
    assert.equal(deleted.status, 200);
    assert.equal(worksheetNamed(deleted.body.workbook, "Pivot1").pivot.range, "A1:B4");

    const refreshed = await send(app.baseUrl, "POST", `${base}/refresh`);
    assert.equal(refreshed.status, 400);
    assert.equal(refreshed.body.error, FIELD_MISSING);

    const stored = (await json(app.baseUrl, DETAIL)).body.workbook;
    // The last successful summary and the source worksheet are both preserved.
    assert.deepEqual(worksheetNamed(stored, "Pivot1").cells, before);
    assert.equal(sourceOf(stored).cells.A2, "East");
    assert.equal(sourceOf(stored).cells.B1, "Status");

    const applied = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    assert.equal(applied.status, 400);
    assert.equal(applied.body.error, FIELD_MISSING);
    assert.deepEqual(worksheetNamed((await json(app.baseUrl, DETAIL)).body.workbook, "Pivot1").cells, before);
  } finally {
    await app.stop();
  }
});

test("SUM and AVERAGE on a value field without numbers keep the previous result", async () => {
  const app = await startApp();
  try {
    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;
    const before = pivot.cells;

    for (const summarizeBy of ["SUM", "AVERAGE"]) {
      const rejected = await send(app.baseUrl, "PUT", base, {
        rowField: "Region",
        columnField: "",
        valueField: "Status",
        summarizeBy,
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, NUMERIC_MESSAGE);
    }
    const stored = (await json(app.baseUrl, DETAIL)).body.workbook;
    assert.deepEqual(worksheetNamed(stored, "Pivot1").cells, before);
    assert.deepEqual(worksheetNamed(stored, "Pivot1").pivot, pivot.pivot);
    assert.deepEqual(sourceOf(stored).cells, SEED_CELLS);

    // COUNT on the same text field is accepted.
    const counted = await send(app.baseUrl, "PUT", base, {
      rowField: "Region",
      columnField: "",
      valueField: "Status",
      summarizeBy: "COUNT",
    });
    assert.equal(counted.status, 200);
    assert.equal(worksheetNamed(counted.body.workbook, "Pivot1").cells.B5, "3");
  } finally {
    await app.stop();
  }
});

test("row and column changes move the pivot source range so a refresh reads the moved data", async () => {
  const app = await startApp();
  try {
    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;

    const insertedRow = await send(app.baseUrl, "POST", `${SOURCE}/structure`, {
      axis: "row",
      mode: "insert-before",
      index: 2,
    });
    assert.equal(insertedRow.status, 200);
    assert.equal(worksheetNamed(insertedRow.body.workbook, "Pivot1").pivot.range, "A1:C5");

    const insertedColumn = await send(app.baseUrl, "POST", `${SOURCE}/structure`, {
      axis: "column",
      mode: "insert-before",
      index: 1,
    });
    assert.equal(insertedColumn.status, 200);
    assert.equal(worksheetNamed(insertedColumn.body.workbook, "Pivot1").pivot.range, "B1:D5");

    const refreshed = await send(app.baseUrl, "POST", `${base}/refresh`);
    assert.equal(refreshed.status, 200);
    const cells = worksheetNamed(refreshed.body.workbook, "Pivot1").cells;
    assert.deepEqual(
      ["A2", "B2", "A3", "B3", "A4", "B4", "A5", "B5"].map((coordinate) => cells[coordinate]),
      ["East", "1200", "North", "800", "South", "700", "Grand Total", "2700"],
    );
  } finally {
    await app.stop();
  }
});

test("malformed pivot requests are rejected without creating or changing a worksheet", async () => {
  const app = await startApp();
  try {
    for (const payload of [{ range: "nope" }, { range: "" }, {}]) {
      const response = await send(app.baseUrl, "POST", `${SOURCE}/pivot`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid pivot table configuration");
    }
    // A region without header cells cannot start a pivot table.
    const headerless = await send(app.baseUrl, "POST", `${SOURCE}/pivot`, { range: "E1:F3" });
    assert.equal(headerless.status, 400);
    assert.equal(headerless.body.error, "Select a range with header cells to create a pivot table");

    const { pivot } = await createPivot(app);
    const base = `${DETAIL}/worksheets/${pivot.id}/pivot`;
    for (const payload of [
      { rowField: "", columnField: "", valueField: "Sales", summarizeBy: "SUM" },
      { rowField: "Region", columnField: "", valueField: "Sales", summarizeBy: "MEDIAN" },
      { rowField: "Region", columnField: 3, valueField: "Sales", summarizeBy: "SUM" },
    ]) {
      const response = await send(app.baseUrl, "PUT", base, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid pivot table configuration");
    }
    // A worksheet that is not a pivot table has no pivot configuration.
    const plain = await send(app.baseUrl, "PUT", `${SOURCE}/pivot`, {
      rowField: "Region",
      columnField: "",
      valueField: "Sales",
      summarizeBy: "SUM",
    });
    assert.equal(plain.status, 400);
    assert.equal(plain.body.error, "Invalid pivot table configuration");

    const stored = (await json(app.baseUrl, DETAIL)).body.workbook;
    assert.equal(stored.worksheets.length, 3);
    assert.deepEqual(worksheetNamed(stored, "Pivot1").cells, pivot.cells);
  } finally {
    await app.stop();
  }
});
