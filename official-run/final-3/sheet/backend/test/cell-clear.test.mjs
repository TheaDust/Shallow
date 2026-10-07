import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

const CLEAR_TEXT_ID = "EVO-M03-CLEAR-TEXT";
const CLEAR_FORMULA_ID = "EVO-M03-CLEAR-FORMULA";
const CLEAR_RANGE_ID = "EVO-M03-CLEAR-RANGE";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-clear-")));
  const server = createServer(createRequestHandler({ dataDir: dir, staticRoot: dir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir: dir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    restart() {
      const restarted = createServer(createRequestHandler({ dataDir: dir, staticRoot: dir }));
      return new Promise((done) =>
        restarted.listen(0, "127.0.0.1", () => {
          done({ server: restarted, baseUrl: `http://127.0.0.1:${restarted.address().port}` });
        }),
      );
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

function workbookOf(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

function clearRange(baseUrl, workbookId, worksheetId, range) {
  return json(
    baseUrl,
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/cells/clear`,
    send("POST", { range }),
  );
}

/** The single active worksheet of a pre-provisioned workbook. */
function activeWorksheet(workbook) {
  return workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId);
}

test("pre-provisions the clear workbooks with their worksheet and cells", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    for (const id of [CLEAR_TEXT_ID, CLEAR_FORMULA_ID, CLEAR_RANGE_ID]) {
      assert.ok(list.body.workbooks.some((entry) => entry.id === id), `missing pre-provisioned workbook ${id}`);
    }

    const text = await workbookOf(app.baseUrl, CLEAR_TEXT_ID);
    const staging = activeWorksheet(text.body.workbook);
    assert.equal(staging.name, "Staging");
    assert.equal(staging.cells.H4, "obsolete tag");

    const formula = await workbookOf(app.baseUrl, CLEAR_FORMULA_ID);
    const calculations = activeWorksheet(formula.body.workbook);
    assert.equal(calculations.name, "Calculations");
    assert.equal(calculations.cells.B7, "13");
    assert.equal(calculations.cells.C7, "=B7*5");
    assert.equal(calculations.cells.D7, "=C7+2");

    const range = await workbookOf(app.baseUrl, CLEAR_RANGE_ID);
    const matrix = activeWorksheet(range.body.workbook);
    assert.equal(matrix.name, "Matrix");
    assert.deepEqual(
      { H4: matrix.cells.H4, I4: matrix.cells.I4, H5: matrix.cells.H5, I5: matrix.cells.I5 },
      { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
    );
  } finally {
    await app.stop();
  }
});

test("clearing a text cell removes it and the cleared state survives a restart", async () => {
  const app = await startApp();
  let worksheetId;
  try {
    const seeded = await workbookOf(app.baseUrl, CLEAR_TEXT_ID);
    worksheetId = activeWorksheet(seeded.body.workbook).id;

    const cleared = await clearRange(app.baseUrl, CLEAR_TEXT_ID, worksheetId, "H4");
    assert.equal(cleared.status, 200);
    assert.equal(activeWorksheet(cleared.body.workbook).cells.H4, undefined);

    const stored = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    const record = stored.workbooks.find((workbook) => workbook.id === CLEAR_TEXT_ID);
    assert.equal(record.worksheets[0].cells.H4, undefined);
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const detail = await workbookOf(restarted.baseUrl, CLEAR_TEXT_ID);
    assert.equal(activeWorksheet(detail.body.workbook).cells.H4, undefined);
  } finally {
    await restarted.stop();
  }
});

test("clearing a formula removes its expression and keeps the dependent formula", async () => {
  const app = await startApp();
  try {
    const seeded = await workbookOf(app.baseUrl, CLEAR_FORMULA_ID);
    const worksheetId = activeWorksheet(seeded.body.workbook).id;

    const cleared = await clearRange(app.baseUrl, CLEAR_FORMULA_ID, worksheetId, "C7");
    assert.equal(cleared.status, 200);
    const cells = activeWorksheet(cleared.body.workbook).cells;
    assert.equal(cells.C7, undefined);
    // The dependent cell keeps its own formula; the blank source recalculates
    // to `2` in the grid (`=C7+2` with an empty C7).
    assert.equal(cells.D7, "=C7+2");
    assert.equal(cells.B7, "13");
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const detail = await workbookOf(restarted.baseUrl, CLEAR_FORMULA_ID);
    const cells = activeWorksheet(detail.body.workbook).cells;
    assert.equal(cells.C7, undefined);
    assert.equal(cells.D7, "=C7+2");
  } finally {
    await restarted.stop();
  }
});

test("clearing a rectangular range empties every cell of the area only", async () => {
  const app = await startApp();
  try {
    const seeded = await workbookOf(app.baseUrl, CLEAR_RANGE_ID);
    const worksheetId = activeWorksheet(seeded.body.workbook).id;

    // The selection is view state: clearing must keep the rectangle selected.
    const selected = await json(
      app.baseUrl,
      `/api/workbooks/${CLEAR_RANGE_ID}/worksheets/${worksheetId}/selection`,
      send("PATCH", { anchor: "H4", focus: "I5" }),
    );
    assert.equal(selected.status, 200);

    const cleared = await clearRange(app.baseUrl, CLEAR_RANGE_ID, worksheetId, "H4:I5");
    assert.equal(cleared.status, 200);
    const worksheet = activeWorksheet(cleared.body.workbook);
    for (const coordinate of ["H4", "I4", "H5", "I5"]) {
      assert.equal(worksheet.cells[coordinate], undefined, `${coordinate} should be cleared`);
    }
    assert.deepEqual(worksheet.selection, { anchor: "H4", focus: "I5" });
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = activeWorksheet((await workbookOf(restarted.baseUrl, CLEAR_RANGE_ID)).body.workbook);
    for (const coordinate of ["H4", "I4", "H5", "I5"]) {
      assert.equal(worksheet.cells[coordinate], undefined);
    }
    assert.deepEqual(worksheet.selection, { anchor: "H4", focus: "I5" });
  } finally {
    await restarted.stop();
  }
});

test("a malformed clear range is rejected and leaves every cell untouched", async () => {
  const app = await startApp();
  try {
    const seeded = await workbookOf(app.baseUrl, CLEAR_RANGE_ID);
    const worksheetId = activeWorksheet(seeded.body.workbook).id;

    for (const range of ["nonsense", "", "H4:", "1:2", undefined]) {
      const rejected = await clearRange(app.baseUrl, CLEAR_RANGE_ID, worksheetId, range);
      assert.equal(rejected.status, 400, `range ${String(range)} should be rejected`);
      assert.equal(rejected.body.error, "Invalid cell range update");
    }

    const unknownSheet = await clearRange(app.baseUrl, CLEAR_RANGE_ID, "ws-does-not-exist", "H4");
    assert.equal(unknownSheet.status, 400);

    const unchanged = await workbookOf(app.baseUrl, CLEAR_RANGE_ID);
    const cells = activeWorksheet(unchanged.body.workbook).cells;
    assert.deepEqual(
      { H4: cells.H4, I4: cells.I4, H5: cells.H5, I5: cells.I5 },
      { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" },
    );
  } finally {
    await app.stop();
  }
});

test("an inherited store missing only this round's seeds gains them once and keeps user values", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-clear-upgrade-"));
  // A store of the previous round: the earlier EVO workbooks (one of them
  // renamed by the user) plus a user workbook, but none of the clear seeds.
  const earlier = EVOLUTION_WORKBOOK_SEEDS.filter((seed) => !seed.id.startsWith("EVO-M03-"));
  assert.ok(earlier.length > 0);
  const renamed = structuredClone(earlier[0]);
  renamed.name = "EVO-M01-RENAME-OK renamed";
  const legacy = {
    workbooks: [
      ...earlier.map((seed, index) => (index === 0 ? renamed : seed)),
      {
        id: "wb-user-clear",
        name: "My notes",
        createdAt: "2026-10-04T09:00:00.000Z",
        updatedAt: "2026-10-04T09:00:00.000Z",
        activeWorksheetId: "ws-user-clear",
        worksheets: [{ id: "ws-user-clear", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { C3: "kept" } }],
      },
    ],
  };
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const app = await startApp(dataDir);
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const seeded = await workbookOf(app.baseUrl, CLEAR_TEXT_ID);
    assert.equal(seeded.status, 200);
    assert.equal(activeWorksheet(seeded.body.workbook).cells.H4, "obsolete tag");
    const kept = await workbookOf(app.baseUrl, "wb-user-clear");
    assert.equal(activeWorksheet(kept.body.workbook).cells.C3, "kept");
    const renamedKept = await workbookOf(app.baseUrl, "EVO-M01-RENAME-OK");
    assert.equal(renamedKept.body.workbook.name, "EVO-M01-RENAME-OK renamed");
  } finally {
    await app.stop();
  }

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
