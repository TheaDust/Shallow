import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/store/workbooks.mjs";

/** Pre-provisioned workbooks of REQ-5-1-2, one per scenario. */
const SAVE = "wb-evo-m04-filter-save";
const SAVE_SHEET = "ws-evo-m04-filter-save-workload";
const APPLY = "wb-evo-m04-filter-apply";
const APPLY_SHEET = "ws-evo-m04-filter-apply-workload";
const DELETE = "wb-evo-m04-filter-delete";
const DELETE_SHEET = "ws-evo-m04-filter-delete-workload";

const QUEUED_LANES = {
  range: "D3:F7",
  columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
};

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-view-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-filter-view-dist-"));
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

function getWorkbook(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${id}`).then((response) => response.body.workbook);
}

function worksheetOf(workbook, worksheetId) {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
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

test("the pre-provisioned filter-view workbooks hold their table and saved view", async () => {
  const app = await startApp();
  try {
    const scenarios = [
      [SAVE, SAVE_SHEET, "EVO-M04-FILTER-SAVE"],
      [APPLY, APPLY_SHEET, "EVO-M04-FILTER-APPLY"],
      [DELETE, DELETE_SHEET, "EVO-M04-FILTER-DELETE"],
    ];
    for (const [id, worksheetId, name] of scenarios) {
      const workbook = await getWorkbook(app.baseUrl, id);
      assert.equal(workbook.name, name);
      const worksheet = worksheetOf(workbook, worksheetId);
      assert.equal(worksheet.name, "Workload");
      assert.deepEqual(worksheet.cells, WORKLOAD_CELLS);
      // A save scenario starts without a view; the other two carry `Queued lanes`.
      if (id === SAVE) assert.equal(workbook.filterViews, undefined);
      else {
        assert.equal(workbook.filterViews.length, 1);
        assert.equal(workbook.filterViews[0].name, "Queued lanes");
        assert.deepEqual(workbook.filterViews[0].filter, QUEUED_LANES);
      }
    }
  } finally {
    await app.stop();
  }
});

test("saving the applied filter trims the name, rejects duplicates and persists", async () => {
  const app = await startApp();
  try {
    const applied = await send(app.baseUrl, "PUT", `/api/workbooks/${SAVE}/worksheets/${SAVE_SHEET}/filter`, {
      filter: QUEUED_LANES,
    });
    assert.equal(applied.status, 200);

    const saved = await send(app.baseUrl, "POST", `/api/workbooks/${SAVE}/filter-views`, {
      name: "  Atlas active load  ",
      filter: QUEUED_LANES,
    });
    assert.equal(saved.status, 201);
    assert.deepEqual(
      saved.body.workbook.filterViews.map((view) => view.name),
      ["Atlas active load"],
    );
    assert.deepEqual(saved.body.workbook.filterViews[0].filter, QUEUED_LANES);

    // The same name in another letter case is still a duplicate, and the
    // rejected save leaves the stored view (and the applied filter) untouched.
    const duplicate = await send(app.baseUrl, "POST", `/api/workbooks/${SAVE}/filter-views`, {
      name: "atlas ACTIVE load",
      filter: { range: "D3:F7", columns: [] },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, "Filter view name already exists");

    const empty = await send(app.baseUrl, "POST", `/api/workbooks/${SAVE}/filter-views`, {
      name: "   ",
      filter: QUEUED_LANES,
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Filter view name cannot be empty");

    await app.restart();
    const reopened = await getWorkbook(app.baseUrl, SAVE);
    assert.deepEqual(
      reopened.filterViews.map((view) => view.name),
      ["Atlas active load"],
    );
    assert.deepEqual(worksheetOf(reopened, SAVE_SHEET).filter, QUEUED_LANES);
    assert.deepEqual(worksheetOf(reopened, SAVE_SHEET).cells, WORKLOAD_CELLS);
  } finally {
    await app.stop();
  }
});

test("applying a saved view replaces the worksheet filter without touching cells", async () => {
  const app = await startApp();
  try {
    const view = (await getWorkbook(app.baseUrl, APPLY)).filterViews[0];
    const applied = await send(
      app.baseUrl,
      "POST",
      `/api/workbooks/${APPLY}/filter-views/${encodeURIComponent(view.id)}/apply`,
      { worksheetId: APPLY_SHEET },
    );
    assert.equal(applied.status, 200);
    const worksheet = worksheetOf(applied.body.workbook, APPLY_SHEET);
    assert.deepEqual(worksheet.filter, QUEUED_LANES);
    assert.deepEqual(worksheet.cells, WORKLOAD_CELLS);

    await app.restart();
    assert.deepEqual(worksheetOf(await getWorkbook(app.baseUrl, APPLY), APPLY_SHEET).filter, QUEUED_LANES);
  } finally {
    await app.stop();
  }
});

test("deleting a saved view removes it and restores every source row", async () => {
  const app = await startApp();
  try {
    const view = (await getWorkbook(app.baseUrl, DELETE)).filterViews[0];
    await send(app.baseUrl, "POST", `/api/workbooks/${DELETE}/filter-views/${encodeURIComponent(view.id)}/apply`, {
      worksheetId: DELETE_SHEET,
    });

    const removed = await send(app.baseUrl, "DELETE", `/api/workbooks/${DELETE}/filter-views/${view.id}`, {
      worksheetId: DELETE_SHEET,
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.workbook.filterViews, undefined);
    const worksheet = worksheetOf(removed.body.workbook, DELETE_SHEET);
    assert.equal(worksheet.filter, undefined);
    // The records keep their values and their order.
    assert.deepEqual(worksheet.cells, WORKLOAD_CELLS);

    await app.restart();
    const reopened = await getWorkbook(app.baseUrl, DELETE);
    assert.equal(reopened.filterViews, undefined);
    assert.equal(worksheetOf(reopened, DELETE_SHEET).filter, undefined);
    assert.deepEqual(worksheetOf(reopened, DELETE_SHEET).cells, WORKLOAD_CELLS);
  } finally {
    await app.stop();
  }
});

test("row and column changes move saved filter views with their cells", async () => {
  const app = await startApp();
  try {
    const inserted = await send(app.baseUrl, "POST", `/api/workbooks/${APPLY}/worksheets/${APPLY_SHEET}/structure`, {
      axis: "row",
      mode: "insert-before",
      index: 3,
    });
    assert.equal(inserted.status, 200);
    assert.equal(inserted.body.workbook.filterViews[0].filter.range, "D4:F8");

    const widened = await send(app.baseUrl, "POST", `/api/workbooks/${APPLY}/worksheets/${APPLY_SHEET}/structure`, {
      axis: "column",
      mode: "insert-before",
      index: 5,
    });
    assert.equal(widened.status, 200);
    const view = widened.body.workbook.filterViews[0];
    assert.equal(view.filter.range, "D4:G8");
    // The `Phase` column moved one to the right with its cells.
    assert.deepEqual(
      view.filter.columns.map((column) => column.column),
      [6],
    );
  } finally {
    await app.stop();
  }
});

test("malformed saves and unknown views are rejected without state changes", async () => {
  const app = await startApp();
  try {
    const options = [
      { name: "View", filter: null },
      { name: "View", filter: { range: "nope", columns: [] } },
      { name: "View", filter: { range: "D3:F7", columns: "no" } },
    ];
    for (const payload of options) {
      const response = await send(app.baseUrl, "POST", `/api/workbooks/${APPLY}/filter-views`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid filter");
    }
    const unknownApply = await send(app.baseUrl, "POST", `/api/workbooks/${APPLY}/filter-views/missing/apply`, {
      worksheetId: APPLY_SHEET,
    });
    assert.equal(unknownApply.status, 400);
    assert.equal(unknownApply.body.error, "Filter view not found");

    const workbook = await getWorkbook(app.baseUrl, APPLY);
    assert.equal(workbook.filterViews.length, 1);
    assert.equal(worksheetOf(workbook, APPLY_SHEET).filter, undefined);
  } finally {
    await app.stop();
  }
});

test("filter views are workbook scoped and never leak into another workbook", async () => {
  const app = await startApp();
  try {
    const view = (await getWorkbook(app.baseUrl, APPLY)).filterViews[0];
    await send(app.baseUrl, "POST", `/api/workbooks/${APPLY}/filter-views/${view.id}/apply`, {
      worksheetId: APPLY_SHEET,
    });
    const baseline = await getWorkbook(app.baseUrl, SEED_WORKBOOK_ID);
    assert.equal(baseline.filterViews, undefined);
    assert.equal(worksheetOf(baseline, SEED_WORKSHEET_ID).filter, undefined);
    const save = await getWorkbook(app.baseUrl, SAVE);
    assert.equal(save.filterViews, undefined);
    assert.equal(save.name, "EVO-M04-FILTER-SAVE");
  } finally {
    await app.stop();
  }
});
