import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

const CREATE_ID = "EVO-N03-NAMED-CREATE";
const INVALID_ID = "EVO-N03-NAMED-INVALID";
const UPDATE_ID = "EVO-N03-NAMED-UPDATE";
const NAME_MESSAGE = "Named range must start with a letter";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-named-")));
  const server = createServer(createRequestHandler({ dataDir: dir, staticRoot: dir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir: dir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
  };
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

function workbookOf(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

async function worksheetOf(baseUrl, id) {
  const detail = await workbookOf(baseUrl, id);
  const workbook = detail.body.workbook;
  return workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId);
}

test("a name that does not start with a letter is rejected and stores nothing", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, INVALID_ID);
    const rejected = await put(app.baseUrl, `/api/workbooks/${INVALID_ID}/named-ranges`, {
      name: "1stBatch",
      worksheetId: worksheet.id,
      range: "K2:K3",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, NAME_MESSAGE);

    const stored = await workbookOf(app.baseUrl, INVALID_ID);
    assert.equal(stored.body.workbook.namedRanges, undefined);
    // The rejected name is gone after a restart as well.
    await app.stop();
    const restarted = await startApp(app.dataDir);
    try {
      const again = await workbookOf(restarted.baseUrl, INVALID_ID);
      assert.equal(again.body.workbook.namedRanges, undefined);
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop().catch(() => undefined);
  }
});

test("a saved name is stored once, survives a restart and is replaced on re-save", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, CREATE_ID);
    const saved = await put(app.baseUrl, `/api/workbooks/${CREATE_ID}/named-ranges`, {
      name: " CapacityPlan ",
      worksheetId: worksheet.id,
      range: "J3:J5",
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.namedRanges, [
      { name: "CapacityPlan", worksheetId: worksheet.id, range: "J3:J5" },
    ]);

    // Re-saving the same name replaces the entry instead of duplicating it.
    const replaced = await put(app.baseUrl, `/api/workbooks/${CREATE_ID}/named-ranges`, {
      name: "CapacityPlan",
      worksheetId: worksheet.id,
      range: "J3:J4",
    });
    assert.equal(replaced.status, 200);
    assert.deepEqual(replaced.body.workbook.namedRanges, [
      { name: "CapacityPlan", worksheetId: worksheet.id, range: "J3:J4" },
    ]);
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const stored = await workbookOf(restarted.baseUrl, CREATE_ID);
    const namedRanges = stored.body.workbook.namedRanges;
    assert.equal(namedRanges.length, 1);
    assert.equal(namedRanges[0].name, "CapacityPlan");
    assert.equal(namedRanges[0].range, "J3:J4");
  } finally {
    await restarted.stop();
  }
});

test("an unknown worksheet or a malformed range is rejected", async () => {
  const app = await startApp();
  try {
    const unknownSheet = await put(app.baseUrl, `/api/workbooks/${CREATE_ID}/named-ranges`, {
      name: "CapacityPlan",
      worksheetId: "ws-does-not-exist",
      range: "J3:J5",
    });
    assert.equal(unknownSheet.status, 400);

    const worksheet = await worksheetOf(app.baseUrl, CREATE_ID);
    const badRange = await put(app.baseUrl, `/api/workbooks/${CREATE_ID}/named-ranges`, {
      name: "CapacityPlan",
      worksheetId: worksheet.id,
      range: "not-a-range",
    });
    assert.equal(badRange.status, 400);

    const stored = await workbookOf(app.baseUrl, CREATE_ID);
    assert.equal(stored.body.workbook.namedRanges, undefined);
  } finally {
    await app.stop();
  }
});

test("the update seed carries MarginBase and its dependent formula", async () => {
  const app = await startApp();
  try {
    const workbook = (await workbookOf(app.baseUrl, UPDATE_ID)).body.workbook;
    assert.deepEqual(workbook.namedRanges, [
      { name: "MarginBase", worksheetId: workbook.activeWorksheetId, range: "K2:K3" },
    ]);
    const worksheet = workbook.worksheets[0];
    assert.equal(worksheet.name, "ForecastModel");
    assert.equal(worksheet.cells.K2, "5");
    assert.equal(worksheet.cells.K3, "8");
    assert.equal(worksheet.cells.K4, "12");
    assert.equal(worksheet.cells.M2, "=SUM(MarginBase)");

    // Changing the range of the stored name keeps it the only entry.
    const extended = await put(app.baseUrl, `/api/workbooks/${UPDATE_ID}/named-ranges`, {
      name: "MarginBase",
      worksheetId: worksheet.id,
      range: "K2:K4",
      previousName: "MarginBase",
    });
    assert.equal(extended.status, 200);
    assert.deepEqual(extended.body.workbook.namedRanges, [
      { name: "MarginBase", worksheetId: worksheet.id, range: "K2:K4" },
    ]);
  } finally {
    await app.stop();
  }
});

test("a row change moves the named ranges of the changed worksheet only", async () => {
  const app = await startApp();
  try {
    const workbook = (await workbookOf(app.baseUrl, UPDATE_ID)).body.workbook;
    const worksheet = workbook.worksheets[0];
    const other = await put(app.baseUrl, `/api/workbooks/${UPDATE_ID}/named-ranges`, {
      name: "CapacityPlan",
      worksheetId: worksheet.id,
      range: "J3:J5",
    });
    assert.equal(other.status, 200);

    const inserted = await json(
      app.baseUrl,
      `/api/workbooks/${UPDATE_ID}/worksheets/${worksheet.id}/structure`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ axis: "row", mode: "insert-before", index: 1 }),
      },
    );
    assert.equal(inserted.status, 200);
    assert.deepEqual(inserted.body.workbook.namedRanges, [
      { name: "MarginBase", worksheetId: worksheet.id, range: "K3:K4" },
      { name: "CapacityPlan", worksheetId: worksheet.id, range: "J4:J6" },
    ]);
  } finally {
    await app.stop();
  }
});

test("an inherited store missing only this round's seeds gains them once and keeps user values", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-named-upgrade-"));
  // A store of the previous round: the earlier EVO workbooks (one edited by the
  // user) plus a user workbook, but none of this round's pre-provisions.
  const earlier = EVOLUTION_WORKBOOK_SEEDS.filter((seed) => !seed.id.startsWith("EVO-N0"));
  assert.ok(earlier.length > 0);
  const edited = structuredClone(earlier[0]);
  edited.worksheets[0].cells.F3 = "edited by user";
  const legacy = {
    workbooks: [
      ...earlier.map((seed, index) => (index === 0 ? edited : seed)),
      {
        id: "wb-user-named",
        name: "My forecast",
        createdAt: "2026-10-07T08:00:00.000Z",
        updatedAt: "2026-10-07T08:00:00.000Z",
        activeWorksheetId: "ws-user-named",
        worksheets: [
          {
            id: "ws-user-named",
            name: "ForecastModel",
            selection: { anchor: "A1", focus: "A1" },
            cells: { K2: "7" },
            formatRules: [{ range: "K2", condition: "greater-than", value: "1", style: "red" }],
          },
        ],
      },
    ],
  };
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const app = await startApp(dataDir);
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const seeded = await workbookOf(app.baseUrl, UPDATE_ID);
    assert.deepEqual(seeded.body.workbook.namedRanges, [
      { name: "MarginBase", worksheetId: seeded.body.workbook.activeWorksheetId, range: "K2:K3" },
    ]);
    const kept = await workbookOf(app.baseUrl, "wb-user-named");
    assert.equal(kept.body.workbook.worksheets[0].cells.K2, "7");
    assert.equal(kept.body.workbook.worksheets[0].formatRules.length, 1);
    const earlierKept = await workbookOf(app.baseUrl, earlier[0].id);
    assert.equal(earlierKept.body.workbook.worksheets[0].cells.F3, "edited by user");
  } finally {
    await app.stop();
  }

  // A second start neither duplicates the seeds nor drops the user's records.
  const restarted = await startApp(dataDir);
  try {
    const list = await json(restarted.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const ids = list.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    await restarted.stop();
  }
});
