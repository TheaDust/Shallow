import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, createSeedState } from "../src/store/workbooks.mjs";

const NAME_MESSAGE = "Named range must start with a letter";

async function startApp(options = {}) {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-named-")));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-named-dist-"));
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

function put(baseUrl, path, payload) {
  return json(baseUrl, path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("a saved named range persists and a name not starting with a letter is rejected", async () => {
  const app = await startApp();
  try {
    const detail = "/api/workbooks/EVO-N03-NAMED-CREATE";
    const loaded = await json(app.baseUrl, detail);
    const worksheet = loaded.body.workbook.worksheets[0];
    assert.equal(worksheet.name, "ForecastModel");
    assert.equal(worksheet.cells.J3, "18");
    assert.equal(worksheet.cells.J4, "24");
    assert.equal(worksheet.cells.J5, "31");
    assert.equal(worksheet.cells.L3, undefined);
    assert.equal(loaded.body.workbook.namedRanges, undefined);

    const saved = await put(app.baseUrl, `${detail}/named-ranges`, {
      name: "CapacityPlan",
      range: "ForecastModel!J3:J5",
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.namedRanges, [
      { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
    ]);

    const rejected = await put(app.baseUrl, `${detail}/named-ranges`, {
      name: "1stBatch",
      range: "ForecastModel!K2:K3",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, NAME_MESSAGE);

    // The rejected name was never stored.
    const after = await json(app.baseUrl, detail);
    assert.deepEqual(after.body.workbook.namedRanges, [
      { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
    ]);

    // The saved name survives a restart.
    await app.restart();
    const again = await json(app.baseUrl, detail);
    assert.deepEqual(again.body.workbook.namedRanges, [
      { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
    ]);
  } finally {
    await app.stop();
  }
});

test("the update scenario pre-provisions MarginBase and editing its range replaces it", async () => {
  const app = await startApp();
  try {
    const detail = "/api/workbooks/EVO-N03-NAMED-UPDATE";
    const loaded = await json(app.baseUrl, detail);
    assert.deepEqual(loaded.body.workbook.namedRanges, [
      { name: "MarginBase", range: "ForecastModel!K2:K3" },
    ]);
    const worksheet = loaded.body.workbook.worksheets[0];
    assert.equal(worksheet.cells.K2, "5");
    assert.equal(worksheet.cells.K3, "8");
    assert.equal(worksheet.cells.K4, "12");
    assert.equal(worksheet.cells.M2, "=SUM(MarginBase)");

    const updated = await put(app.baseUrl, `${detail}/named-ranges`, {
      name: "MarginBase",
      range: "ForecastModel!K2:K4",
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.workbook.namedRanges, [
      { name: "MarginBase", range: "ForecastModel!K2:K4" },
    ]);

    await app.restart();
    const again = await json(app.baseUrl, detail);
    assert.deepEqual(again.body.workbook.namedRanges, [
      { name: "MarginBase", range: "ForecastModel!K2:K4" },
    ]);
  } finally {
    await app.stop();
  }
});

test("a malformed reference is rejected and leaves the saved names untouched", async () => {
  const app = await startApp();
  try {
    const detail = "/api/workbooks/EVO-N03-NAMED-INVALID";
    for (const payload of [
      { name: "Plan", range: "nope" },
      { name: "Plan", range: "" },
      { name: "Plan Two", range: "K2:K3" },
    ]) {
      const response = await put(app.baseUrl, `${detail}/named-ranges`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
    }
    const after = await json(app.baseUrl, detail);
    assert.equal(after.body.workbook.namedRanges, undefined);
  } finally {
    await app.stop();
  }
});

test("upgrading a data directory adds the named-range and formatting workbooks exactly once", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-named-upgrade-"));
  await mkdir(dataDir, { recursive: true });
  const q3 = createSeedState().workbooks.find((workbook) => workbook.id === SEED_WORKBOOK_ID);
  const userWorkbook = {
    id: "user-wb-named",
    name: "My Forecast",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeWorksheetId: "user-ws-named",
    worksheets: [
      { id: "user-ws-named", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "keep" } },
    ],
  };
  await writeFile(
    join(dataDir, "workbooks.json"),
    JSON.stringify({ workbooks: [q3, userWorkbook] }, null, 2),
    "utf8",
  );

  const app = await startApp({ dataDir });
  try {
    const newIds = [
      "EVO-N03-NAMED-CREATE",
      "EVO-N03-NAMED-INVALID",
      "EVO-N03-NAMED-UPDATE",
      "EVO-N04-FORMAT-NUMBER",
      "EVO-N04-FORMAT-TEXT",
      "EVO-N04-FORMAT-EDIT",
    ];
    const listed = await json(app.baseUrl, "/api/workbooks");
    const ids = listed.body.workbooks.map((workbook) => workbook.id);
    for (const id of [SEED_WORKBOOK_ID, "user-wb-named", ...newIds]) {
      assert.ok(ids.includes(id), `${id} present after upgrade`);
    }
    // The pre-provisioned named range came with the upgrade.
    const update = await json(app.baseUrl, "/api/workbooks/EVO-N03-NAMED-UPDATE");
    assert.deepEqual(update.body.workbook.namedRanges, [{ name: "MarginBase", range: "ForecastModel!K2:K3" }]);
    const edit = await json(app.baseUrl, "/api/workbooks/EVO-N04-FORMAT-EDIT");
    assert.equal(edit.body.workbook.worksheets[0].conditionalFormats.length, 1);

    await app.restart();
    const after = await json(app.baseUrl, "/api/workbooks");
    const count = (id) => after.body.workbooks.filter((workbook) => workbook.id === id).length;
    for (const id of [SEED_WORKBOOK_ID, "user-wb-named", ...newIds]) {
      assert.equal(count(id), 1, `${id} appears exactly once`);
    }
    const user = await json(app.baseUrl, "/api/workbooks/user-wb-named");
    assert.equal(user.body.workbook.name, "My Forecast");
    assert.equal(user.body.workbook.worksheets[0].cells.A1, "keep");
  } finally {
    await app.stop();
  }
});
