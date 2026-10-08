import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, createSeedState } from "../src/store/workbooks.mjs";

const SAVE_ID = "EVO-M04-FILTER-SAVE";
const APPLY_ID = "EVO-M04-FILTER-APPLY";
const DELETE_ID = "EVO-M04-FILTER-DELETE";
const NEW_SEED_IDS = [SAVE_ID, APPLY_ID, DELETE_ID, "EVO-M05-VALIDATION-FORMULA", "EVO-M05-VALIDATION-GRID", "EVO-M05-VALIDATION-EDIT"];
const DUPLICATE_MESSAGE = "Filter view name already exists";

async function startApp(dataDir) {
  if (!dataDir) dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-view-"));
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

function worksheetOf(body, worksheetId) {
  return body.workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

const BASE_RANGE = { range: "D3:F7", columns: [{ column: 4, header: "Workstream", mode: "condition", condition: "Text contains", value: "Atlas" }] };

test("the saved-filter-view scenarios start from their own pre-provisioned workbooks", async () => {
  const app = await startApp();
  try {
    const save = await json(app.baseUrl, `/api/workbooks/${SAVE_ID}`);
    assert.equal(save.status, 200);
    const workload = worksheetOf(save.body, `${SAVE_ID}--Workload`);
    assert.deepEqual(workload.cells, {
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
    });
    // Saving starts from an applied filter, so the workbook ships none.
    assert.equal(workload.filter, undefined);
    assert.equal(workload.filterViews, undefined);

    for (const id of [APPLY_ID, DELETE_ID]) {
      const loaded = await json(app.baseUrl, `/api/workbooks/${id}`);
      const sheet = worksheetOf(loaded.body, `${id}--Workload`);
      assert.deepEqual(sheet.cells, workload.cells);
      assert.deepEqual(sheet.filterViews, [
        {
          id: `${id}--queued-lanes`,
          name: "Queued lanes",
          filter: {
            range: "D3:F7",
            columns: [{ column: 5, header: "Phase", mode: "values", values: ["Queued"] }],
          },
        },
      ]);
      // The saved view is not applied yet: opening the workbook shows every record.
      assert.equal(sheet.filter, undefined);
    }
  } finally {
    await app.stop();
  }
});

test("a saved view is trimmed, unique within the workbook and rejects a duplicate without changing anything", async () => {
  const app = await startApp();
  try {
    const base = `/api/workbooks/${DELETE_ID}/worksheets/${DELETE_ID}--Workload`;
    const applied = await send(app.baseUrl, "PUT", `${base}/filter`, { filter: BASE_RANGE });
    assert.equal(applied.status, 200);

    const duplicate = await send(app.baseUrl, "POST", `${base}/filter-views`, { name: " queued lanes " });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error, DUPLICATE_MESSAGE);
    // The rejected save leaves the stored view as it was.
    const afterReject = await json(app.baseUrl, `/api/workbooks/${DELETE_ID}`);
    assert.equal(worksheetOf(afterReject.body, `${DELETE_ID}--Workload`).filterViews.length, 1);

    const empty = await send(app.baseUrl, "POST", `${base}/filter-views`, { name: "   " });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Filter view name cannot be empty");

    const saved = await send(app.baseUrl, "POST", `${base}/filter-views`, { name: "  Atlas lanes  " });
    assert.equal(saved.status, 201);
    const views = worksheetOf(saved.body, `${DELETE_ID}--Workload`).filterViews;
    assert.equal(views.length, 2);
    assert.equal(views[1].name, "Atlas lanes");
    assert.deepEqual(views[1].filter, BASE_RANGE);

    await app.restart();
    const reloaded = await json(app.baseUrl, `/api/workbooks/${DELETE_ID}`);
    const persisted = worksheetOf(reloaded.body, `${DELETE_ID}--Workload`).filterViews;
    assert.equal(persisted.length, 2);
    assert.deepEqual(persisted[1].filter, BASE_RANGE);
  } finally {
    await app.stop();
  }
});

test("applying a saved view replaces the current filter and deleting it restores every record", async () => {
  const app = await startApp();
  try {
    const base = `/api/workbooks/${APPLY_ID}/worksheets/${APPLY_ID}--Workload`;
    const detail = `/api/workbooks/${APPLY_ID}`;
    const before = worksheetOf((await json(app.baseUrl, detail)).body, `${APPLY_ID}--Workload`);

    // Applying the saved view is a filter write with the view's stored criteria.
    const view = before.filterViews[0];
    const applied = await send(app.baseUrl, "PUT", `${base}/filter`, { filter: view.filter });
    assert.equal(applied.status, 200);
    assert.deepEqual(worksheetOf(applied.body, `${APPLY_ID}--Workload`).filter, view.filter);
    // Cells and validation behaviour are untouched by the view.
    assert.deepEqual(worksheetOf(applied.body, `${APPLY_ID}--Workload`).cells, before.cells);

    await app.restart();
    const stillFiltered = worksheetOf((await json(app.baseUrl, detail)).body, `${APPLY_ID}--Workload`);
    assert.deepEqual(stillFiltered.filter, view.filter);
    assert.equal(stillFiltered.filterViews.length, 1);

    const deleted = await send(app.baseUrl, "DELETE", `${base}/filter-views/${encodeURIComponent(view.id)}`);
    assert.equal(deleted.status, 200);
    const after = worksheetOf(deleted.body, `${APPLY_ID}--Workload`);
    assert.equal(after.filterViews, undefined);
    assert.equal(after.filter, undefined);
    assert.deepEqual(after.cells, before.cells);

    await app.restart();
    const reloaded = worksheetOf((await json(app.baseUrl, detail)).body, `${APPLY_ID}--Workload`);
    assert.equal(reloaded.filterViews, undefined);
    assert.equal(reloaded.filter, undefined);
    assert.deepEqual(reloaded.cells, before.cells);

    const missing = await send(app.baseUrl, "DELETE", `${base}/filter-views/nope`);
    assert.equal(missing.status, 400);
  } finally {
    await app.stop();
  }
});

test("upgrades an older store with the filter-view and validation scenarios without dropping records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-filter-view-upgrade-"));
  await mkdir(dataDir, { recursive: true });
  // Simulate a store shipped before this round: the baseline workbook plus a
  // user workbook with a saved filter view of its own.
  const baseline = createSeedState().workbooks.find((workbook) => workbook.id === SEED_WORKBOOK_ID);
  const userWorkbook = {
    id: "user-wb-keep",
    name: "My Workload",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeWorksheetId: "user-ws-1",
    worksheets: [
      {
        id: "user-ws-1",
        name: "Sheet1",
        selection: { anchor: "A1", focus: "A1" },
        cells: { A1: "keep" },
        filterViews: [{ id: "user-view-1", name: "Mine", filter: { range: "A1:A2", columns: [] } }],
      },
    ],
  };
  await writeFile(
    join(dataDir, "workbooks.json"),
    JSON.stringify({ workbooks: [baseline, userWorkbook] }, null, 2),
    "utf8",
  );

  const app = await startApp(dataDir);
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const ids = list.body.workbooks.map((workbook) => workbook.id);
    for (const id of [...NEW_SEED_IDS, SEED_WORKBOOK_ID, "user-wb-keep"]) {
      assert.ok(ids.includes(id), `${id} present after upgrade`);
    }
    const user = await json(app.baseUrl, "/api/workbooks/user-wb-keep");
    assert.equal(worksheetOf(user.body, "user-ws-1").cells.A1, "keep");
    assert.equal(worksheetOf(user.body, "user-ws-1").filterViews[0].name, "Mine");

    await app.restart();
    const after = await json(app.baseUrl, "/api/workbooks");
    const count = (id) => after.body.workbooks.filter((workbook) => workbook.id === id).length;
    for (const id of [...NEW_SEED_IDS, SEED_WORKBOOK_ID, "user-wb-keep"]) {
      assert.equal(count(id), 1, `${id} appears exactly once`);
    }
  } finally {
    await app.stop();
  }
});
