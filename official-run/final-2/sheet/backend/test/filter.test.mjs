import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/store/workbooks.mjs";

const BASE = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`;
const DETAIL = `/api/workbooks/${SEED_WORKBOOK_ID}`;

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-filter-dist-"));
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

function worksheetOf(body) {
  return body.workbook.worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID);
}

const SAMPLE_FILTER = {
  range: "A1:C4",
  columns: [
    { column: 1, header: "Region", mode: "values", values: ["East", "South"] },
    { column: 2, header: "Sales", mode: "condition", condition: "Greater than", value: "800" },
  ],
};

test("saving a filter keeps the source cells and survives a restart", async () => {
  const app = await startApp();
  try {
    const before = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    const saved = await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    assert.equal(saved.status, 200);
    assert.deepEqual(worksheetOf(saved.body).filter, SAMPLE_FILTER);
    // A filter is a view: the underlying records and their order are untouched.
    assert.deepEqual(worksheetOf(saved.body).cells, before.cells);

    await app.restart();
    const reopened = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    assert.deepEqual(reopened.filter, SAMPLE_FILTER);
    assert.deepEqual(reopened.cells, before.cells);
  } finally {
    await app.stop();
  }
});

test("clearing a filter removes the view and leaves every record in place", async () => {
  const app = await startApp();
  try {
    const before = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    const cleared = await send(app.baseUrl, "DELETE", `${BASE}/filter`);
    assert.equal(cleared.status, 200);
    assert.equal(worksheetOf(cleared.body).filter, undefined);
    assert.deepEqual(worksheetOf(cleared.body).cells, before.cells);

    await app.restart();
    assert.equal(worksheetOf((await json(app.baseUrl, DETAIL)).body).filter, undefined);
  } finally {
    await app.stop();
  }
});

test("a filter of one worksheet never affects another worksheet", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    const detail = (await json(app.baseUrl, DETAIL)).body;
    const second = detail.workbook.worksheets.find((worksheet) => worksheet.id !== SEED_WORKSHEET_ID);
    assert.equal(second.filter, undefined);
    assert.deepEqual(second.cells, {});
  } finally {
    await app.stop();
  }
});

test("malformed filters are rejected and leave the stored view untouched", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });
    for (const payload of [
      { filter: null },
      { filter: { range: "nope", columns: [] } },
      { filter: { range: "A1:C4", columns: "no" } },
      { filter: { range: "A1:C4", columns: [{ column: 0, header: "Region", mode: "values", values: [] }] } },
      { filter: { range: "A1:C4", columns: [{ column: 1, header: "Region", mode: "sort" }] } },
      { filter: { range: "A1:C4", columns: [{ column: 1, header: "Region", mode: "condition", condition: "Equals" }] } },
    ]) {
      const response = await send(app.baseUrl, "PUT", `${BASE}/filter`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid filter");
    }
    assert.deepEqual(worksheetOf((await json(app.baseUrl, DETAIL)).body).filter, SAMPLE_FILTER);
  } finally {
    await app.stop();
  }
});

test("row and column changes move validation rules and the filter view with their cells", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PUT", `${BASE}/validation-rule`, {
      range: "A2:B2",
      type: "number-range",
      min: 0,
      max: 100,
    });
    await send(app.baseUrl, "PUT", `${BASE}/filter`, { filter: SAMPLE_FILTER });

    // Inserting a row above row 2 pushes the constrained cells down one line.
    const inserted = await send(app.baseUrl, "POST", `${BASE}/structure`, {
      axis: "row",
      mode: "insert-before",
      index: 2,
    });
    assert.equal(inserted.status, 200);
    const afterInsert = worksheetOf(inserted.body);
    assert.deepEqual(afterInsert.validationRules, [
      { range: "A3:B3", type: "number-range", min: 0, max: 100 },
    ]);
    assert.equal(afterInsert.filter.range, "A1:C5");

    // Inserting a column left of column 1 moves the filter's columns with it.
    const widened = await send(app.baseUrl, "POST", `${BASE}/structure`, {
      axis: "column",
      mode: "insert-before",
      index: 1,
    });
    const afterColumn = worksheetOf(widened.body);
    assert.equal(afterColumn.filter.range, "B1:D5");
    assert.deepEqual(
      afterColumn.filter.columns.map((column) => column.column),
      [2, 3],
    );
    assert.deepEqual(afterColumn.validationRules, [
      { range: "B3:C3", type: "number-range", min: 0, max: 100 },
    ]);

    // The rule still rejects an out-of-range value on its moved cells.
    const rejected = await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "B3", value: "101" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    // Deleting the row a rule covers exactly drops the now-meaningless rule.
    const deleted = await send(app.baseUrl, "POST", `${BASE}/structure`, {
      axis: "row",
      mode: "delete",
      index: 3,
    });
    assert.equal(deleted.status, 200);
    assert.equal(worksheetOf(deleted.body).validationRules, undefined);
  } finally {
    await app.stop();
  }
});

const SAVE_VIEW_BASE = "/api/workbooks/wb-evo-m04-filter-save/filter-views";
const APPLY_VIEW_BASE = "/api/workbooks/wb-evo-m04-filter-apply/filter-views";
const DELETE_VIEW_BASE = "/api/workbooks/wb-evo-m04-filter-delete/filter-views";
const SAVE_VIEW_SHEET = "ws-evo-m04-filter-save-workload";
const APPLY_VIEW_SHEET = "ws-evo-m04-filter-apply-workload";
const DELETE_VIEW_SHEET = "ws-evo-m04-filter-delete-workload";
const SAVE_VIEW_DETAIL = "/api/workbooks/wb-evo-m04-filter-save";
const APPLY_VIEW_DETAIL = "/api/workbooks/wb-evo-m04-filter-apply";
const DELETE_VIEW_DETAIL = "/api/workbooks/wb-evo-m04-filter-delete";

/** One worksheet of a workbook payload, looked up by its stable id. */
function sheetOf(body, worksheetId) {
  return body.workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

/**
 * Pre-provisioned `Workload` grid cells of every `EVO-M04-*` workbook: rows
 * `Atlas/Queued/17`, `Atlas/Active/31`, `Beacon/Queued/22`, `Cirrus/Queued/9`.
 */
const WORKLOAD_CELLS = {
  D3: "Workstream",
  E3: "Phase",
  F3: "Load",
  D4: "Atlas",
  E4: "Queued",
  F4: "17",
  D5: "Atlas",
  E5: "Active",
  F5: "31",
  D6: "Beacon",
  E6: "Queued",
  F6: "22",
  D7: "Cirrus",
  E7: "Queued",
  F7: "9",
};

test("pre-provisions the independent EVO-M04 filter-view workbooks", async () => {
  const app = await startApp();
  try {
    const apply = (await json(app.baseUrl, APPLY_VIEW_DETAIL)).body.workbook;
    assert.equal(apply.name, "EVO-M04-FILTER-APPLY");
    assert.deepEqual(sheetOf({ workbook: apply }, APPLY_VIEW_SHEET).cells, WORKLOAD_CELLS);
    assert.deepEqual(
      apply.filterViews.map((view) => view.name),
      ["Queued lanes"],
    );
    assert.deepEqual(apply.filterViews[0].filter.columns[1], {
      column: 5,
      header: "Phase",
      mode: "values",
      values: ["Queued"],
    });

    const save = (await json(app.baseUrl, SAVE_VIEW_DETAIL)).body.workbook;
    assert.equal(save.filterViews, undefined);
    assert.deepEqual(sheetOf({ workbook: save }, SAVE_VIEW_SHEET).cells, WORKLOAD_CELLS);

    const remove = (await json(app.baseUrl, DELETE_VIEW_DETAIL)).body.workbook;
    assert.deepEqual(
      remove.filterViews.map((view) => view.name),
      ["Queued lanes"],
    );
  } finally {
    await app.stop();
  }
});

test("saving a filter view trims its name and keeps the criteria across a restart", async () => {
  const app = await startApp();
  try {
    const applied = await send(app.baseUrl, "PUT", `/api/workbooks/wb-evo-m04-filter-save/worksheets/${SAVE_VIEW_SHEET}/filter`, {
      filter: {
        range: "D3:F7",
        columns: [
          { column: 4, header: "Workstream", mode: "condition", condition: "Text contains", value: "Atlas" },
          { column: 6, header: "Load", mode: "condition", condition: "Greater than", value: "20" },
        ],
      },
    });
    assert.equal(applied.status, 200);

    const saved = await send(app.baseUrl, "POST", SAVE_VIEW_BASE, {
      worksheetId: SAVE_VIEW_SHEET,
      name: "  Atlas active load  ",
    });
    assert.equal(saved.status, 201);
    assert.deepEqual(
      saved.body.workbook.filterViews.map((view) => view.name),
      ["Atlas active load"],
    );

    await app.restart();

    const reopened = (await json(app.baseUrl, SAVE_VIEW_DETAIL)).body.workbook;
    assert.deepEqual(
      reopened.filterViews.map((view) => view.name),
      ["Atlas active load"],
    );
    assert.deepEqual(reopened.filterViews[0].filter, applied.body.workbook.worksheets[0].filter);
    assert.deepEqual(sheetOf({ workbook: reopened }, SAVE_VIEW_SHEET).cells, WORKLOAD_CELLS);
  } finally {
    await app.stop();
  }
});

test("a filter view needs a name and an applied filter and never duplicates a name", async () => {
  const app = await startApp();
  try {
    const withoutFilter = await send(app.baseUrl, "POST", SAVE_VIEW_BASE, {
      worksheetId: SAVE_VIEW_SHEET,
      name: "Atlas active load",
    });
    assert.equal(withoutFilter.status, 400);
    assert.equal(withoutFilter.body.error, "Create a filter before saving a filter view");

    await send(app.baseUrl, "PUT", `/api/workbooks/wb-evo-m04-filter-delete/worksheets/${DELETE_VIEW_SHEET}/filter`, {
      filter: { range: "D3:F7", columns: [] },
    });

    const blank = await send(app.baseUrl, "POST", DELETE_VIEW_BASE, {
      worksheetId: DELETE_VIEW_SHEET,
      name: "   ",
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "Filter view name cannot be empty");

    // `Queued lanes` is pre-provisioned, so ` queued lanes ` is a duplicate.
    const duplicate = await send(app.baseUrl, "POST", DELETE_VIEW_BASE, {
      worksheetId: DELETE_VIEW_SHEET,
      name: " queued lanes ",
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, "Filter view name already exists");

    await app.restart();
    const reopened = (await json(app.baseUrl, DELETE_VIEW_DETAIL)).body.workbook;
    assert.deepEqual(
      reopened.filterViews.map((view) => view.name),
      ["Queued lanes"],
    );
  } finally {
    await app.stop();
  }
});

test("applying a saved view replaces the filters and deleting it restores every row", async () => {
  const app = await startApp();
  try {
    const before = sheetOf((await json(app.baseUrl, APPLY_VIEW_DETAIL)).body, APPLY_VIEW_SHEET);
    assert.equal(before.filter, undefined);

    const applied = await send(app.baseUrl, "PUT", APPLY_VIEW_BASE, {
      worksheetId: APPLY_VIEW_SHEET,
      name: "Queued lanes",
    });
    assert.equal(applied.status, 200);
    const appliedSheet = sheetOf(applied.body, APPLY_VIEW_SHEET);
    assert.deepEqual(appliedSheet.filter, {
      range: "D3:F7",
      columns: [
        { column: 4, header: "Workstream", mode: "values", values: [] },
        { column: 5, header: "Phase", mode: "values", values: ["Queued"] },
        { column: 6, header: "Load", mode: "values", values: [] },
      ],
    });
    assert.deepEqual(appliedSheet.cells, before.cells);

    await app.restart();
    const reopened = sheetOf((await json(app.baseUrl, APPLY_VIEW_DETAIL)).body, APPLY_VIEW_SHEET);
    assert.deepEqual(reopened.filter, appliedSheet.filter);

    // Deleting the applied view removes the criteria and every source row returns.
    const deleted = await send(app.baseUrl, "DELETE", APPLY_VIEW_BASE, { name: "Queued lanes" });
    assert.equal(deleted.status, 200);
    assert.equal(sheetOf(deleted.body, APPLY_VIEW_SHEET).filter, undefined);
    assert.deepEqual(sheetOf(deleted.body, APPLY_VIEW_SHEET).cells, before.cells);
    assert.equal(deleted.body.workbook.filterViews, undefined);

    await app.restart();
    const persisted = (await json(app.baseUrl, APPLY_VIEW_DETAIL)).body.workbook;
    assert.equal(persisted.filterViews, undefined);
    assert.equal(sheetOf({ workbook: persisted }, APPLY_VIEW_SHEET).filter, undefined);
    assert.deepEqual(sheetOf({ workbook: persisted }, APPLY_VIEW_SHEET).cells, before.cells);

    const unknown = await send(app.baseUrl, "DELETE", APPLY_VIEW_BASE, { name: "Queued lanes" });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "Filter view not found");
  } finally {
    await app.stop();
  }
});
