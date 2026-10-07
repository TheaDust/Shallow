import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

const FREEZE_ROW_ID = "EVO-N01-FREEZE-ROW";
const FREEZE_COLUMN_ID = "EVO-N01-FREEZE-COLUMN";
const FREEZE_BOTH_ID = "EVO-N01-FREEZE-BOTH";
const FIND_NEXT_ID = "EVO-N02-FIND-NEXT";
const REPLACE_ALL_ID = "EVO-N02-REPLACE-ALL";
const CASE_SENSITIVE_ID = "EVO-N02-CASE-SENSITIVE";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-navigation-")));
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

async function worksheetOf(baseUrl, id) {
  const detail = await workbookOf(baseUrl, id);
  const workbook = detail.body.workbook;
  return workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId);
}

function freezeRequest(baseUrl, workbookId, worksheetId, rows, columns) {
  return json(
    baseUrl,
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/freeze`,
    send("PATCH", { rows, columns }),
  );
}

function replaceRequest(baseUrl, workbookId, worksheetId, body) {
  return json(
    baseUrl,
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/replace`,
    send("POST", body),
  );
}

test("pre-provisions the freeze and find workbooks with their worksheet and cells", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    for (const id of [
      FREEZE_ROW_ID,
      FREEZE_COLUMN_ID,
      FREEZE_BOTH_ID,
      FIND_NEXT_ID,
      REPLACE_ALL_ID,
      CASE_SENSITIVE_ID,
    ]) {
      assert.ok(list.body.workbooks.some((entry) => entry.id === id), `missing pre-provisioned workbook ${id}`);
    }

    const row = await worksheetOf(app.baseUrl, FREEZE_ROW_ID);
    assert.equal(row.name, "ScrollLedger");
    assert.ok(row.cells.A1, "row 1 holds the headers");
    assert.ok(row.cells.L1, "the header row reaches column L");
    assert.ok(row.cells.A40, "data reaches row 40");
    assert.equal(row.freeze, undefined);

    const column = await worksheetOf(app.baseUrl, FREEZE_COLUMN_ID);
    assert.equal(column.name, "ScrollLedger");
    assert.ok(column.cells.L1, "the header row reaches column L");
    assert.ok(column.cells.L12, "data reaches column L");
    assert.equal(column.cells.M1, undefined);

    const both = await worksheetOf(app.baseUrl, FREEZE_BOTH_ID);
    assert.equal(both.name, "ScrollLedger");
    assert.ok(both.cells.A40 && both.cells.L40, "data reaches row 40 and column L");

    const findNext = await worksheetOf(app.baseUrl, FIND_NEXT_ID);
    assert.equal(findNext.name, "Narrative");
    assert.deepEqual(
      { E4: findNext.cells.E4, E7: findNext.cells.E7, E11: findNext.cells.E11 },
      { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
    );

    const replaceAll = await worksheetOf(app.baseUrl, REPLACE_ALL_ID);
    assert.equal(replaceAll.name, "Narrative");
    assert.deepEqual(
      { F3: replaceAll.cells.F3, F6: replaceAll.cells.F6, F9: replaceAll.cells.F9, F12: replaceAll.cells.F12 },
      { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" },
    );

    const cases = await worksheetOf(app.baseUrl, CASE_SENSITIVE_ID);
    assert.equal(cases.name, "Narrative");
    assert.deepEqual(
      { G3: cases.cells.G3, G4: cases.cells.G4, G5: cases.cells.G5 },
      { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" },
    );
  } finally {
    await app.stop();
  }
});

test("frozen row and column counts are stored per worksheet and survive a restart", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, FREEZE_BOTH_ID);
    const frozen = await freezeRequest(app.baseUrl, FREEZE_BOTH_ID, worksheet.id, 3, 2);
    assert.equal(frozen.status, 200);
    const stored = frozen.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id);
    assert.deepEqual(stored.freeze, { rows: 3, columns: 2 });

    // Freezing one axis keeps the other one, as the View menu promises.
    const rowsOnly = await freezeRequest(app.baseUrl, FREEZE_BOTH_ID, worksheet.id, 1, 2);
    assert.deepEqual(
      rowsOnly.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id).freeze,
      { rows: 1, columns: 2 },
    );
    const cleared = await freezeRequest(app.baseUrl, FREEZE_BOTH_ID, worksheet.id, 0, 0);
    assert.equal(cleared.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id).freeze, undefined);

    await freezeRequest(app.baseUrl, FREEZE_BOTH_ID, worksheet.id, 3, 2);
    const onDisk = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    const record = onDisk.workbooks.find((workbook) => workbook.id === FREEZE_BOTH_ID);
    assert.deepEqual(record.worksheets[0].freeze, { rows: 3, columns: 2 });
    // Freezing never touches the records themselves.
    assert.equal(record.worksheets[0].cells.A2, "E-0002");
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, FREEZE_BOTH_ID);
    assert.deepEqual(worksheet.freeze, { rows: 3, columns: 2 });
  } finally {
    await restarted.stop();
  }
});

test("a malformed freeze request is rejected and leaves the stored counts untouched", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, FREEZE_ROW_ID);
    await freezeRequest(app.baseUrl, FREEZE_ROW_ID, worksheet.id, 1, 0);

    for (const [rows, columns] of [
      [-1, 0],
      [1.5, 0],
      [undefined, 0],
      [1, "2"],
    ]) {
      const rejected = await freezeRequest(app.baseUrl, FREEZE_ROW_ID, worksheet.id, rows, columns);
      assert.equal(rejected.status, 400, `${String(rows)}/${String(columns)} should be rejected`);
      assert.equal(rejected.body.error, "Invalid freeze request");
    }

    const unknown = await freezeRequest(app.baseUrl, FREEZE_ROW_ID, "ws-does-not-exist", 1, 0);
    assert.equal(unknown.status, 400);

    const unchanged = await worksheetOf(app.baseUrl, FREEZE_ROW_ID);
    assert.deepEqual(unchanged.freeze, { rows: 1, columns: 0 });
  } finally {
    await app.stop();
  }
});

test("replacing all matches rewrites only whole-value matches and persists them", async () => {
  const app = await startApp();
  let worksheetId;
  try {
    const worksheet = await worksheetOf(app.baseUrl, REPLACE_ALL_ID);
    worksheetId = worksheet.id;

    const replaced = await replaceRequest(app.baseUrl, REPLACE_ALL_ID, worksheetId, {
      find: "Cobalt",
      replaceWith: "Indigo",
      matchCase: false,
    });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.replaced, 3);
    const cells = replaced.body.workbook.worksheets.find((candidate) => candidate.id === worksheetId).cells;
    assert.deepEqual(
      { F3: cells.F3, F6: cells.F6, F9: cells.F9, F12: cells.F12 },
      { F3: "Indigo", F6: "Indigo", F9: "Indigo", F12: "Copper" },
    );
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, REPLACE_ALL_ID);
    assert.deepEqual(
      { F3: worksheet.cells.F3, F6: worksheet.cells.F6, F9: worksheet.cells.F9, F12: worksheet.cells.F12 },
      { F3: "Indigo", F6: "Indigo", F9: "Indigo", F12: "Copper" },
    );

    // A second run finds nothing left to replace.
    const again = await replaceRequest(restarted.baseUrl, REPLACE_ALL_ID, worksheet.id, {
      find: "Cobalt",
      replaceWith: "Indigo",
      matchCase: false,
    });
    assert.equal(again.body.replaced, 0);
  } finally {
    await restarted.stop();
  }
});

test("a case-sensitive replacement changes only the exactly matching cell", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, CASE_SENSITIVE_ID);

    const exact = await replaceRequest(app.baseUrl, CASE_SENSITIVE_ID, worksheet.id, {
      find: "Cobalt",
      replaceWith: "Azure",
      matchCase: true,
    });
    assert.equal(exact.body.replaced, 1);
    const cells = exact.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id).cells;
    assert.deepEqual(
      { G3: cells.G3, G4: cells.G4, G5: cells.G5 },
      { G3: "Azure", G4: "cobalt", G5: "Cobalt-7" },
    );
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, CASE_SENSITIVE_ID);
    assert.deepEqual(
      { G3: worksheet.cells.G3, G4: worksheet.cells.G4, G5: worksheet.cells.G5 },
      { G3: "Azure", G4: "cobalt", G5: "Cobalt-7" },
    );
  } finally {
    await restarted.stop();
  }
});

test("without Match case both spellings match while a longer value still does not", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, CASE_SENSITIVE_ID);

    const replaced = await replaceRequest(app.baseUrl, CASE_SENSITIVE_ID, worksheet.id, {
      find: "Cobalt",
      replaceWith: "Azure",
      matchCase: false,
    });
    assert.equal(replaced.body.replaced, 2, "both Cobalt and cobalt match");
    const cells = replaced.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id).cells;
    assert.deepEqual(
      { G3: cells.G3, G4: cells.G4, G5: cells.G5 },
      { G3: "Azure", G4: "Azure", G5: "Cobalt-7" },
    );
  } finally {
    await app.stop();
  }
});

test("an empty or malformed replacement is rejected and keeps every value", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, FIND_NEXT_ID);

    const noFind = await replaceRequest(app.baseUrl, FIND_NEXT_ID, worksheet.id, {
      find: "",
      replaceWith: "Indigo",
      matchCase: false,
    });
    assert.equal(noFind.status, 400);
    assert.equal(noFind.body.error, "Enter the text to find");

    const badTarget = await replaceRequest(app.baseUrl, FIND_NEXT_ID, worksheet.id, {
      find: "Cobalt",
      replaceWith: 7,
      matchCase: false,
    });
    assert.equal(badTarget.status, 400);

    const unknown = await replaceRequest(app.baseUrl, FIND_NEXT_ID, "ws-does-not-exist", {
      find: "Cobalt",
      replaceWith: "Indigo",
      matchCase: false,
    });
    assert.equal(unknown.status, 400);

    const unchanged = await worksheetOf(app.baseUrl, FIND_NEXT_ID);
    assert.deepEqual(
      { E4: unchanged.cells.E4, E7: unchanged.cells.E7, E11: unchanged.cells.E11 },
      { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" },
    );
  } finally {
    await app.stop();
  }
});

test("a replacement rejected by a validation rule changes nothing at all", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, REPLACE_ALL_ID);
    const rule = await json(
      app.baseUrl,
      `/api/workbooks/${REPLACE_ALL_ID}/worksheets/${worksheet.id}/validation-rule`,
      send("PUT", { range: "F3", type: "number-range", min: 0, max: 5 }),
    );
    assert.equal(rule.status, 200);

    const rejected = await replaceRequest(app.baseUrl, REPLACE_ALL_ID, worksheet.id, {
      find: "Cobalt",
      replaceWith: "Indigo",
      matchCase: false,
    });
    assert.equal(rejected.status, 400);

    const cells = (await worksheetOf(app.baseUrl, REPLACE_ALL_ID)).cells;
    assert.deepEqual(
      { F3: cells.F3, F6: cells.F6, F9: cells.F9 },
      { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt" },
    );
  } finally {
    await app.stop();
  }
});

test("an inherited store missing only this round's seeds gains them once and keeps user values", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-navigation-upgrade-"));
  // A store of the previous round: the earlier EVO workbooks (one of them
  // edited by the user) plus a user workbook, but none of the navigation seeds.
  const earlier = EVOLUTION_WORKBOOK_SEEDS.filter((seed) => !seed.id.startsWith("EVO-N0"));
  assert.ok(earlier.length > 0);
  const edited = structuredClone(earlier[0]);
  edited.worksheets[0].cells.F3 = "edited by user";
  const legacy = {
    workbooks: [
      ...earlier.map((seed, index) => (index === 0 ? edited : seed)),
      {
        id: "wb-user-navigation",
        name: "My ledger",
        createdAt: "2026-10-06T08:00:00.000Z",
        updatedAt: "2026-10-06T08:00:00.000Z",
        activeWorksheetId: "ws-user-navigation",
        worksheets: [{ id: "ws-user-navigation", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { C3: "kept" } }],
      },
    ],
  };
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const app = await startApp(dataDir);
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const seeded = await worksheetOf(app.baseUrl, FREEZE_ROW_ID);
    assert.ok(seeded.cells.A40);
    const kept = await worksheetOf(app.baseUrl, "wb-user-navigation");
    assert.equal(kept.cells.C3, "kept");
    const editedKept = await worksheetOf(app.baseUrl, earlier[0].id);
    assert.equal(editedKept.cells.F3, "edited by user");
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
