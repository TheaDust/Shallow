import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_FILTER_APPLY_WORKBOOK_ID,
  EVO_FILTER_APPLY_WORKSHEET_ID,
  EVO_FILTER_DELETE_WORKBOOK_ID,
  EVO_FILTER_DELETE_WORKSHEET_ID,
  EVO_FILTER_SAVE_WORKBOOK_ID,
  EVO_FILTER_SAVE_WORKSHEET_ID,
  EVO_VALIDATION_EDIT_WORKBOOK_ID,
  EVO_VALIDATION_FORMULA_WORKBOOK_ID,
  EVO_VALIDATION_FORMULA_WORKSHEET_ID,
  EVO_VALIDATION_GRID_WORKBOOK_ID,
  EVO_VALIDATION_GRID_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

const SAVE_BASE = `/api/workbooks/${EVO_FILTER_SAVE_WORKBOOK_ID}/worksheets/${EVO_FILTER_SAVE_WORKSHEET_ID}`;
const APPLY_BASE = `/api/workbooks/${EVO_FILTER_APPLY_WORKBOOK_ID}/worksheets/${EVO_FILTER_APPLY_WORKSHEET_ID}`;
const DELETE_BASE = `/api/workbooks/${EVO_FILTER_DELETE_WORKBOOK_ID}/worksheets/${EVO_FILTER_DELETE_WORKSHEET_ID}`;
const DUPLICATE_MESSAGE = "Filter view name already exists";

/** The two-condition filter of the save scenario: Atlas workstream, load > 20. */
const ATLAS_FILTER = {
  range: "D3:F7",
  columns: [
    { column: 4, header: "Workstream", mode: "condition", condition: "Text contains", value: "Atlas" },
    { column: 6, header: "Load", mode: "condition", condition: "Greater than", value: "20" },
  ],
};

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-views-"));
  if (prepare) await prepare(dataDir);
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function worksheetOf(baseUrl, workbookId, worksheetId) {
  const detail = await json(baseUrl, `/api/workbooks/${workbookId}`);
  return detail.body.workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

async function workbookOf(baseUrl, workbookId) {
  const detail = await json(baseUrl, `/api/workbooks/${workbookId}`);
  return detail.body.workbook;
}

test("saving the applied filter stores a named view and rejects a duplicate name", async () => {
  const app = await startApp();
  try {
    const applied = await json(app.baseUrl, `${SAVE_BASE}/filter`, send("PUT", { filter: ATLAS_FILTER }));
    assert.equal(applied.status, 200);

    const saved = await json(app.baseUrl, `${SAVE_BASE}/filter-views`, send("POST", { name: " Atlas active load " }));
    assert.equal(saved.status, 201);
    const worksheet = saved.body.workbook.worksheets.find((entry) => entry.id === EVO_FILTER_SAVE_WORKSHEET_ID);
    assert.equal(worksheet.filterViews.length, 1);
    assert.equal(worksheet.filterViews[0].name, "Atlas active load");
    assert.equal(worksheet.filterViews[0].range, "D3:F7");
    assert.deepEqual(worksheet.filterViews[0].columns, ATLAS_FILTER.columns);
    // Saving a view is view state only: the records keep their values and order.
    assert.equal(worksheet.cells.D5, "Atlas");
    assert.equal(worksheet.cells.E5, "Active");
    // The applied filter itself is still the one that was saved.
    assert.deepEqual(worksheet.filter, ATLAS_FILTER);

    // A duplicate is rejected after trimming and ignoring letter case.
    const duplicate = await json(app.baseUrl, `${SAVE_BASE}/filter-views`, send("POST", { name: "atlas ACTIVE load" }));
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, DUPLICATE_MESSAGE);
    const after = await worksheetOf(app.baseUrl, EVO_FILTER_SAVE_WORKBOOK_ID, EVO_FILTER_SAVE_WORKSHEET_ID);
    assert.equal(after.filterViews.length, 1);

    // An empty name is rejected too, and a view without an applied filter fails.
    const empty = await json(app.baseUrl, `${SAVE_BASE}/filter-views`, send("POST", { name: "   " }));
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Filter view name cannot be empty");

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_FILTER_SAVE_WORKBOOK_ID, EVO_FILTER_SAVE_WORKSHEET_ID);
    assert.equal(persisted.filterViews.length, 1);
    assert.equal(persisted.filterViews[0].name, "Atlas active load");
    assert.equal(persisted.filterViews[0].columns[1].condition, "Greater than");
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a view with no applied filter cannot be saved and the views stay untouched", async () => {
  const app = await startApp();
  try {
    const rejected = await json(app.baseUrl, `${SAVE_BASE}/filter-views`, send("POST", { name: "No filter yet" }));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Invalid filter");
    const worksheet = await worksheetOf(app.baseUrl, EVO_FILTER_SAVE_WORKBOOK_ID, EVO_FILTER_SAVE_WORKSHEET_ID);
    assert.equal(worksheet.filterViews, undefined);
    assert.equal(worksheet.filter, undefined);
  } finally {
    await app.stop();
  }
});

test("applying a pre-provisioned view replaces the filter and keeps the saved view", async () => {
  const app = await startApp();
  try {
    const before = await worksheetOf(app.baseUrl, EVO_FILTER_APPLY_WORKBOOK_ID, EVO_FILTER_APPLY_WORKSHEET_ID);
    assert.equal(before.filterViews.length, 1);
    assert.equal(before.filterViews[0].name, "Queued lanes");
    assert.equal(before.filter, undefined);

    const applied = await json(
      app.baseUrl,
      `${APPLY_BASE}/filter-views/apply`,
      send("POST", { id: before.filterViews[0].id }),
    );
    assert.equal(applied.status, 200);
    const worksheet = applied.body.workbook.worksheets.find((entry) => entry.id === EVO_FILTER_APPLY_WORKSHEET_ID);
    assert.deepEqual(worksheet.filter, {
      range: "D3:F7",
      columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
    });
    // The saved view keeps its own criteria, so it can be applied again later.
    assert.equal(worksheet.filterViews.length, 1);
    assert.equal(worksheet.filterViews[0].name, "Queued lanes");
    assert.equal(worksheet.cells.D5, "Atlas");

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_FILTER_APPLY_WORKBOOK_ID, EVO_FILTER_APPLY_WORKSHEET_ID);
    assert.deepEqual(persisted.filter, worksheet.filter);
    assert.equal(persisted.filterViews.length, 1);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("deleting the selected view removes it and restores every record", async () => {
  const app = await startApp();
  try {
    const before = await worksheetOf(app.baseUrl, EVO_FILTER_DELETE_WORKBOOK_ID, EVO_FILTER_DELETE_WORKSHEET_ID);
    const viewId = before.filterViews[0].id;
    await json(app.baseUrl, `${DELETE_BASE}/filter-views/apply`, send("POST", { id: viewId }));
    assert.equal((await worksheetOf(app.baseUrl, EVO_FILTER_DELETE_WORKBOOK_ID, EVO_FILTER_DELETE_WORKSHEET_ID)).filter.columns[0].values[0], "Queued");

    const removed = await json(app.baseUrl, `${DELETE_BASE}/filter-views`, send("DELETE", { id: viewId }));
    assert.equal(removed.status, 200);
    const worksheet = removed.body.workbook.worksheets.find((entry) => entry.id === EVO_FILTER_DELETE_WORKSHEET_ID);
    assert.equal(worksheet.filterViews, undefined);
    assert.equal(worksheet.filter, undefined);
    assert.deepEqual(worksheet.cells, before.cells);

    // An unknown view is rejected without touching the stored worksheet.
    const unknown = await json(app.baseUrl, `${DELETE_BASE}/filter-views`, send("DELETE", { id: "missing" }));
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "Unknown filter view");

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_FILTER_DELETE_WORKBOOK_ID, EVO_FILTER_DELETE_WORKSHEET_ID);
    assert.equal(persisted.filterViews, undefined);
    assert.equal(persisted.filter, undefined);
    assert.deepEqual(persisted.cells, before.cells);
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("view names stay unique across the worksheets of one workbook", async () => {
  const app = await startApp();
  try {
    const added = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_FILTER_APPLY_WORKBOOK_ID}/worksheets`,
      { method: "POST" },
    );
    assert.equal(added.status, 201);
    const secondWorksheetId = added.body.workbook.worksheets.at(-1).id;
    await json(
      app.baseUrl,
      `/api/workbooks/${EVO_FILTER_APPLY_WORKBOOK_ID}/worksheets/${secondWorksheetId}/filter`,
      send("PUT", { filter: ATLAS_FILTER }),
    );
    const duplicate = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_FILTER_APPLY_WORKBOOK_ID}/worksheets/${secondWorksheetId}/filter-views`,
      send("POST", { name: "Queued Lanes" }),
    );
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, DUPLICATE_MESSAGE);
  } finally {
    await app.stop();
  }
});

test("row and column changes move saved filter views with their records", async () => {
  const app = await startApp();
  try {
    const inserted = await json(
      app.baseUrl,
      `${APPLY_BASE}/structure`,
      send("POST", { axis: "row", mode: "insert-before", index: 3 }),
    );
    assert.equal(inserted.status, 200);
    const shifted = inserted.body.workbook.worksheets.find((entry) => entry.id === EVO_FILTER_APPLY_WORKSHEET_ID);
    assert.equal(shifted.filterViews[0].range, "D4:F8");
    // The moved view still filters the same Phase column of its range.
    const applied = await json(
      app.baseUrl,
      `${APPLY_BASE}/filter-views/apply`,
      send("POST", { id: shifted.filterViews[0].id }),
    );
    const appliedWorksheet = applied.body.workbook.worksheets.find((entry) => entry.id === EVO_FILTER_APPLY_WORKSHEET_ID);
    assert.deepEqual(appliedWorksheet.filter.columns, [
      { column: 5, header: "Phase", mode: "values", values: ["Queued"] },
    ]);
  } finally {
    await app.stop();
  }
});

test("the custom validation messages of this round are pre-provisioned", async () => {
  const app = await startApp();
  try {
    const formulaBase = `/api/workbooks/${EVO_VALIDATION_FORMULA_WORKBOOK_ID}/worksheets/${EVO_VALIDATION_FORMULA_WORKSHEET_ID}`;
    const formula = await worksheetOf(app.baseUrl, EVO_VALIDATION_FORMULA_WORKBOOK_ID, EVO_VALIDATION_FORMULA_WORKSHEET_ID);
    assert.equal(formula.name, "Thresholds");
    assert.equal(formula.cells.J6, "37");
    const rejected = await json(app.baseUrl, `${formulaBase}/cells`, send("PATCH", { coordinate: "J6", value: "88" }));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Capacity must be from 25 to 75");
    assert.equal(
      (await worksheetOf(app.baseUrl, EVO_VALIDATION_FORMULA_WORKBOOK_ID, EVO_VALIDATION_FORMULA_WORKSHEET_ID)).cells.J6,
      "37",
    );

    const gridBase = `/api/workbooks/${EVO_VALIDATION_GRID_WORKBOOK_ID}/worksheets/${EVO_VALIDATION_GRID_WORKSHEET_ID}`;
    const grid = await worksheetOf(app.baseUrl, EVO_VALIDATION_GRID_WORKBOOK_ID, EVO_VALIDATION_GRID_WORKSHEET_ID);
    assert.equal(grid.cells.K8, "Ready");
    const paused = await json(app.baseUrl, `${gridBase}/cells`, send("PATCH", { coordinate: "K8", value: "Paused" }));
    assert.equal(paused.status, 400);
    assert.equal(paused.body.error, "Choose a queue state");
    assert.equal(
      (await worksheetOf(app.baseUrl, EVO_VALIDATION_GRID_WORKBOOK_ID, EVO_VALIDATION_GRID_WORKSHEET_ID)).cells.K8,
      "Ready",
    );

    const edit = await workbookOf(app.baseUrl, EVO_VALIDATION_EDIT_WORKBOOK_ID);
    assert.equal(edit.worksheets[0].cells.L4, "42");
    assert.deepEqual(edit.worksheets[0].validationRules, [
      { range: "L4", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
    ]);
  } finally {
    await app.stop();
  }
});

test("upgrades an older store with this round's workbooks only once", async () => {
  const newIds = [
    EVO_FILTER_SAVE_WORKBOOK_ID,
    EVO_FILTER_APPLY_WORKBOOK_ID,
    EVO_FILTER_DELETE_WORKBOOK_ID,
    EVO_VALIDATION_FORMULA_WORKBOOK_ID,
    EVO_VALIDATION_GRID_WORKBOOK_ID,
    EVO_VALIDATION_EDIT_WORKBOOK_ID,
  ];
  const legacy = createSeedState();
  legacy.workbooks = legacy.workbooks.filter((workbook) => !newIds.includes(workbook.id));
  legacy.workbooks[0].worksheets[0].cells.A1 = "Region edited";
  legacy.workbooks[0].worksheets[0].filter = {
    range: "A1:C4",
    columns: [{ column: 1, header: "Region", mode: "values", values: ["East"] }],
  };
  legacy.workbooks.push({
    id: "user-workbook-1",
    name: "My own workbook",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:05:00.000Z",
    activeWorksheetId: "user-worksheet-1",
    worksheets: [
      {
        id: "user-worksheet-1",
        name: "Sheet1",
        selection: { anchor: "A1", focus: "A1" },
        cells: { A1: "keep me" },
        filterViews: [
          {
            id: "user-view-1",
            name: "My own view",
            range: "A1:A2",
            columns: [{ column: 1, header: "A", mode: "values", values: ["keep me"] }],
          },
        ],
      },
    ],
  });

  const app = await startApp(async (dataDir) => {
    await writeFile(join(dataDir, "workbooks.json"), JSON.stringify(legacy, null, 2), "utf8");
  });
  const first = await json(app.baseUrl, "/api/workbooks");
  const ids = first.body.workbooks.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const expected of newIds) assert.ok(ids.includes(expected), `upgrade must add ${expected}`);
  assert.ok(ids.includes("user-workbook-1"));

  const upgraded = await worksheetOf(app.baseUrl, EVO_FILTER_APPLY_WORKBOOK_ID, EVO_FILTER_APPLY_WORKSHEET_ID);
  assert.equal(upgraded.filterViews.length, 1);
  assert.equal(upgraded.filterViews[0].name, "Queued lanes");

  const restarted = await app.restart();
  const second = await json(restarted.baseUrl, "/api/workbooks");
  const secondIds = second.body.workbooks.map((entry) => entry.id);
  assert.equal(new Set(secondIds).size, secondIds.length);
  assert.equal(secondIds.length, ids.length);

  // Earlier records, user changes and user-owned views survive the upgrade.
  const baseline = await workbookOf(restarted.baseUrl, SEED_WORKBOOK_ID);
  assert.equal(baseline.worksheets[0].cells.A1, "Region edited");
  assert.deepEqual(baseline.worksheets[0].filter.columns[0].values, ["East"]);
  const user = await workbookOf(restarted.baseUrl, "user-workbook-1");
  assert.equal(user.worksheets[0].cells.A1, "keep me");
  assert.equal(user.worksheets[0].filterViews[0].name, "My own view");
  await restarted.stop();
  await app.stop();
});
