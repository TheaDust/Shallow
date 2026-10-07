import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

const SAVE_ID = "EVO-M04-FILTER-SAVE";
const APPLY_ID = "EVO-M04-FILTER-APPLY";
const DELETE_ID = "EVO-M04-FILTER-DELETE";

/** Criteria of the pre-provisioned `Queued lanes` view (Phase equals `Queued`). */
const QUEUED_LANES = {
  range: "D3:F7",
  columns: [
    { column: 4, header: "Workstream", mode: "values", values: [] },
    { column: 5, header: "Phase", mode: "values", values: ["Queued"] },
    { column: 6, header: "Load", mode: "values", values: [] },
  ],
};

/** Criteria of a two-condition view over the same region. */
const ATLAS_LOAD = {
  range: "D3:F7",
  columns: [
    { column: 4, header: "Workstream", mode: "condition", condition: "Text contains", value: "Atlas" },
    { column: 5, header: "Phase", mode: "values", values: [] },
    { column: 6, header: "Load", mode: "condition", condition: "Greater than", value: "20" },
  ],
};

async function startApp({ dataDir } = {}) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-filter-view-")));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-filter-view-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html>", "utf8");
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  let server;
  const app = {
    dataDir: dir,
    baseUrl: "",
    async listen() {
      server = createServer(createRequestHandler({ dataDir: dir, staticRoot }));
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

function workbookOf(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

function activeWorksheet(workbook) {
  return workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId);
}

/** Base path of the active worksheet of a pre-provisioned workbook. */
function baseOf(workbook, id) {
  return `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(workbook.activeWorksheetId)}`;
}

async function worksheetBase(app, id) {
  const detail = await workbookOf(app.baseUrl, id);
  return baseOf(detail.body.workbook, id);
}

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

test("pre-provisions the filter-view workbooks with their records and saved views", async () => {
  const app = await startApp();
  try {
    for (const id of [SAVE_ID, APPLY_ID, DELETE_ID]) {
      const detail = await workbookOf(app.baseUrl, id);
      assert.equal(detail.status, 200);
      const worksheet = activeWorksheet(detail.body.workbook);
      assert.equal(worksheet.name, "Workload");
      assert.deepEqual(worksheet.cells, WORKLOAD_CELLS);
    }

    const save = activeWorksheet((await workbookOf(app.baseUrl, SAVE_ID)).body.workbook);
    assert.equal(save.filterViews, undefined);
    assert.equal(save.filter, undefined);

    for (const id of [APPLY_ID, DELETE_ID]) {
      const worksheet = activeWorksheet((await workbookOf(app.baseUrl, id)).body.workbook);
      assert.deepEqual(worksheet.filterViews, [{ name: "Queued lanes", filter: QUEUED_LANES }]);
      // The seeded workbook starts unfiltered: the view is applied on request.
      assert.equal(worksheet.filter, undefined);
    }
  } finally {
    await app.stop();
  }
});

test("saving the applied filter stores a trimmed, unique name that survives a restart", async () => {
  const app = await startApp();
  try {
    const base = await worksheetBase(app, SAVE_ID);
    await send(app.baseUrl, "PUT", `${base}/filter`, { filter: ATLAS_LOAD });

    const saved = await send(app.baseUrl, "PUT", `${base}/filter-views`, {
      name: "  Atlas active load  ",
      filter: ATLAS_LOAD,
    });
    assert.equal(saved.status, 200);
    const worksheet = activeWorksheet(saved.body.workbook);
    assert.deepEqual(worksheet.filterViews, [{ name: "Atlas active load", filter: ATLAS_LOAD }]);
    // Saving a view never changes the applied filter or the records.
    assert.deepEqual(worksheet.filter, ATLAS_LOAD);
    assert.deepEqual(worksheet.cells, WORKLOAD_CELLS);

    await app.restart();
    const reopened = activeWorksheet((await workbookOf(app.baseUrl, SAVE_ID)).body.workbook);
    assert.deepEqual(reopened.filterViews, [{ name: "Atlas active load", filter: ATLAS_LOAD }]);
    assert.deepEqual(reopened.filter, ATLAS_LOAD);
  } finally {
    await app.stop();
  }
});

test("a duplicate or empty view name is rejected without storing anything", async () => {
  const app = await startApp();
  try {
    const base = await worksheetBase(app, APPLY_ID);
    for (const name of ["Queued lanes", "queued lanes", "  QUEUED LANES  "]) {
      const response = await send(app.baseUrl, "PUT", `${base}/filter-views`, { name, filter: ATLAS_LOAD });
      assert.equal(response.status, 400, name);
      assert.equal(response.body.error, "Filter view name already exists");
    }
    const empty = await send(app.baseUrl, "PUT", `${base}/filter-views`, { name: "   ", filter: ATLAS_LOAD });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Filter view name cannot be empty");

    const worksheet = activeWorksheet((await workbookOf(app.baseUrl, APPLY_ID)).body.workbook);
    assert.deepEqual(worksheet.filterViews, [{ name: "Queued lanes", filter: QUEUED_LANES }]);
  } finally {
    await app.stop();
  }
});

test("a saved view name is unique across the whole workbook", async () => {
  const app = await startApp();
  try {
    const added = await send(app.baseUrl, "POST", `/api/workbooks/${encodeURIComponent(APPLY_ID)}/worksheets`);
    const second = activeWorksheet(added.body.workbook);
    const base = `/api/workbooks/${encodeURIComponent(APPLY_ID)}/worksheets/${encodeURIComponent(second.id)}`;
    const duplicate = await send(app.baseUrl, "PUT", `${base}/filter-views`, {
      name: "Queued lanes",
      filter: QUEUED_LANES,
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, "Filter view name already exists");

    const other = await send(app.baseUrl, "PUT", `${base}/filter-views`, { name: "Added lanes", filter: QUEUED_LANES });
    assert.equal(other.status, 200);
    assert.deepEqual(activeWorksheet(other.body.workbook).filterViews, [
      { name: "Added lanes", filter: QUEUED_LANES },
    ]);
  } finally {
    await app.stop();
  }
});

test("deleting a saved view removes it and restores every source row", async () => {
  const app = await startApp();
  try {
    const base = await worksheetBase(app, DELETE_ID);
    // Applying the view hides the `Atlas/Active/31` record of row 5.
    const applied = await send(app.baseUrl, "PUT", `${base}/filter`, { filter: QUEUED_LANES });
    assert.deepEqual(activeWorksheet(applied.body.workbook).filter, QUEUED_LANES);

    const deleted = await send(app.baseUrl, "DELETE", `${base}/filter-views`, { name: "Queued lanes" });
    assert.equal(deleted.status, 200);
    const worksheet = activeWorksheet(deleted.body.workbook);
    assert.equal(worksheet.filterViews, undefined);
    assert.equal(worksheet.filter, undefined);
    assert.deepEqual(worksheet.cells, WORKLOAD_CELLS);

    await app.restart();
    const reopened = activeWorksheet((await workbookOf(app.baseUrl, DELETE_ID)).body.workbook);
    assert.equal(reopened.filterViews, undefined);
    assert.equal(reopened.filter, undefined);
  } finally {
    await app.stop();
  }
});

test("upgrades an inherited store: old records stay and the new seeds arrive once", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-view-upgrade-"));
  const legacy = {
    workbooks: [
      {
        id: "wb-q3-sales",
        name: "Q3 Sales 2026",
        createdAt: "2026-09-21T09:00:00.000Z",
        updatedAt: "2026-09-28T14:05:00.000Z",
        activeWorksheetId: "ws-q3-sheet1",
        worksheets: [
          { id: "ws-q3-sheet1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "User note" } },
        ],
      },
      {
        id: DELETE_ID,
        name: DELETE_ID,
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T09:01:00.000Z",
        activeWorksheetId: "ws-legacy-workload",
        worksheets: [
          {
            id: "ws-legacy-workload",
            name: "Workload",
            selection: { anchor: "A1", focus: "A1" },
            cells: { A1: "user edit" },
          },
        ],
      },
    ],
  };
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const app = await startApp({ dataDir });
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const baseline = await workbookOf(app.baseUrl, "wb-q3-sales");
    assert.equal(baseline.body.workbook.name, "Q3 Sales 2026");
    assert.equal(baseline.body.workbook.worksheets[0].cells.A1, "User note");
    // The inherited record keeps its own cells; the missing seeds are added.
    const kept = await workbookOf(app.baseUrl, DELETE_ID);
    assert.equal(kept.body.workbook.worksheets[0].cells.A1, "user edit");
    assert.equal(kept.body.workbook.worksheets[0].filterViews, undefined);

    const seeded = await workbookOf(app.baseUrl, APPLY_ID);
    assert.deepEqual(activeWorksheet(seeded.body.workbook).filterViews, [
      { name: "Queued lanes", filter: QUEUED_LANES },
    ]);
    const validation = await workbookOf(app.baseUrl, "EVO-M05-VALIDATION-FORMULA");
    assert.deepEqual(activeWorksheet(validation.body.workbook).validationRules, [
      { range: "J6", type: "number-range", min: 25, max: 75, errorMessage: "Capacity must be from 25 to 75" },
    ]);
  } finally {
    await app.stop();
  }

  const restarted = await startApp({ dataDir });
  try {
    const list = await json(restarted.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const stored = JSON.parse(await readFile(join(dataDir, "workbooks.json"), "utf8"));
    assert.equal(stored.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const ids = stored.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    const views = activeWorksheet((await workbookOf(restarted.baseUrl, APPLY_ID)).body.workbook).filterViews;
    assert.deepEqual(views, [{ name: "Queued lanes", filter: QUEUED_LANES }]);
  } finally {
    await restarted.stop();
  }
});

test("a row/column change moves the saved views with their records", async () => {
  const app = await startApp();
  try {
    const base = await worksheetBase(app, APPLY_ID);
    const saved = await send(app.baseUrl, "PUT", `${base}/filter-views`, { name: "Atlas lanes", filter: ATLAS_LOAD });
    assert.equal(saved.status, 200);

    await send(app.baseUrl, "POST", `${base}/structure`, { axis: "row", mode: "insert-before", index: 3 });
    const inserted = activeWorksheet((await workbookOf(app.baseUrl, APPLY_ID)).body.workbook);
    assert.deepEqual(
      inserted.filterViews.map((view) => view.filter.range),
      ["D4:F8", "D4:F8"],
    );

    await send(app.baseUrl, "POST", `${base}/structure`, { axis: "column", mode: "delete", index: 5 });
    const shifted = activeWorksheet((await workbookOf(app.baseUrl, APPLY_ID)).body.workbook);
    for (const view of shifted.filterViews) {
      assert.equal(view.filter.range, "D4:E8");
      assert.deepEqual(
        view.filter.columns.map((column) => column.column),
        [4, 5],
      );
    }
  } finally {
    await app.stop();
  }
});
