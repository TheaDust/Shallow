import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  DUPLICATE_WORKSHEET_NAME_MESSAGE,
  EMPTY_WORKSHEET_NAME_MESSAGE,
  SEED_WORKBOOK_ID,
  WORKSHEET_NAME_TOO_LONG_MESSAGE,
  createSeedState,
} from "../src/store/workbooks.mjs";

const OK_ID = "EVO-M02-SHEET-OK";
const DUP_ID = "EVO-M02-SHEET-DUP";
const LIMIT_ID = "EVO-M02-SHEET-LIMIT";

/** The 51-character scenario value: 51 `B`s. */
const TOO_LONG_NAME = "B".repeat(51);
/** Exactly the 50-character limit. */
const MAX_LENGTH_NAME = "C".repeat(50);

async function startApp({ dataDir: provided } = {}) {
  const dataDir = provided ?? (await mkdtemp(join(tmpdir(), "shallowcode-sheet-rename-")));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((done) => server.close(done)),
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
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

function rename(baseUrl, workbookId, worksheetId, name) {
  return json(baseUrl, `/api/workbooks/${workbookId}/worksheets/${worksheetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

function getWorkbook(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${id}`).then((response) => response.body.workbook);
}

function worksheetNamed(workbook, name) {
  return workbook.worksheets.find((worksheet) => worksheet.name === name);
}

test("the EVO worksheet rename scenarios start from their own pre-provisioned workbooks", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const ids = list.body.workbooks.map((workbook) => workbook.id);
    for (const id of [OK_ID, DUP_ID, LIMIT_ID]) {
      assert.ok(ids.includes(id), `${id} is pre-provisioned`);
    }

    const ok = await getWorkbook(app.baseUrl, OK_ID);
    assert.equal(ok.name, OK_ID);
    assert.deepEqual(
      ok.worksheets.map((worksheet) => worksheet.name),
      ["HarborDraft", "LedgerView"],
    );
    assert.equal(worksheetNamed(ok, "HarborDraft").cells.D5, "dock marker");
    assert.equal(ok.activeWorksheetId, worksheetNamed(ok, "HarborDraft").id);

    const dup = await getWorkbook(app.baseUrl, DUP_ID);
    assert.deepEqual(
      dup.worksheets.map((worksheet) => worksheet.name),
      ["Meridian", "ArchiveBay"],
    );
    assert.equal(dup.activeWorksheetId, worksheetNamed(dup, "ArchiveBay").id);

    const limit = await getWorkbook(app.baseUrl, LIMIT_ID);
    assert.deepEqual(
      limit.worksheets.map((worksheet) => worksheet.name),
      ["LengthGauge"],
    );
    assert.equal(worksheetNamed(limit, "LengthGauge").cells.G4, "sheet sentinel");
    assert.equal(limit.activeWorksheetId, worksheetNamed(limit, "LengthGauge").id);
  } finally {
    await app.stop();
  }
});

test("renames a worksheet after trimming and keeps the name, active tab and cells across restarts", async () => {
  const app = await startApp();
  try {
    const before = await getWorkbook(app.baseUrl, OK_ID);
    const draft = worksheetNamed(before, "HarborDraft");

    const renamed = await rename(app.baseUrl, OK_ID, draft.id, "  Dispatch Register  ");
    assert.equal(renamed.status, 200);
    assert.deepEqual(
      renamed.body.workbook.worksheets.map((worksheet) => worksheet.name),
      ["Dispatch Register", "LedgerView"],
    );
    assert.equal(renamed.body.workbook.activeWorksheetId, draft.id);
    assert.equal(worksheetNamed(renamed.body.workbook, "Dispatch Register").cells.D5, "dock marker");

    const restarted = await app.restart();
    try {
      const persisted = await getWorkbook(restarted.baseUrl, OK_ID);
      assert.deepEqual(
        persisted.worksheets.map((worksheet) => worksheet.name),
        ["Dispatch Register", "LedgerView"],
      );
      assert.equal(persisted.activeWorksheetId, draft.id);
      assert.equal(worksheetNamed(persisted, "Dispatch Register").cells.D5, "dock marker");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a worksheet name differing only by case and keeps the original name", async () => {
  const app = await startApp();
  try {
    const before = await getWorkbook(app.baseUrl, DUP_ID);
    const archive = worksheetNamed(before, "ArchiveBay");

    const rejected = await rename(app.baseUrl, DUP_ID, archive.id, "meridian");
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, DUPLICATE_WORKSHEET_NAME_MESSAGE);

    const restarted = await app.restart();
    try {
      const after = await getWorkbook(restarted.baseUrl, DUP_ID);
      assert.deepEqual(
        after.worksheets.map((worksheet) => worksheet.name),
        ["Meridian", "ArchiveBay"],
      );
      assert.equal(after.activeWorksheetId, archive.id);
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a worksheet name longer than 50 characters and keeps the original active tab and cells", async () => {
  const app = await startApp();
  try {
    assert.equal(TOO_LONG_NAME.length, 51);
    const before = await getWorkbook(app.baseUrl, LIMIT_ID);
    const gauge = worksheetNamed(before, "LengthGauge");

    const rejected = await rename(app.baseUrl, LIMIT_ID, gauge.id, TOO_LONG_NAME);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, WORKSHEET_NAME_TOO_LONG_MESSAGE);

    const restarted = await app.restart();
    try {
      const after = await getWorkbook(restarted.baseUrl, LIMIT_ID);
      assert.equal(after.worksheets[0].name, "LengthGauge");
      assert.equal(after.activeWorksheetId, gauge.id);
      assert.equal(after.worksheets[0].cells.G4, "sheet sentinel");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("accepts a 50-character worksheet name and rejects longer and empty ones", async () => {
  const app = await startApp();
  try {
    assert.equal(MAX_LENGTH_NAME.length, 50);
    const before = await getWorkbook(app.baseUrl, OK_ID);
    const ledger = worksheetNamed(before, "LedgerView");

    const accepted = await rename(app.baseUrl, OK_ID, ledger.id, MAX_LENGTH_NAME);
    assert.equal(accepted.status, 200);
    assert.ok(worksheetNamed(accepted.body.workbook, MAX_LENGTH_NAME));

    // 51 characters is one over the limit; blank names stay rejected too.
    const tooLong = await rename(app.baseUrl, OK_ID, ledger.id, `${MAX_LENGTH_NAME}D`);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, WORKSHEET_NAME_TOO_LONG_MESSAGE);

    const blank = await rename(app.baseUrl, OK_ID, ledger.id, "   ");
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, EMPTY_WORKSHEET_NAME_MESSAGE);

    const kept = await getWorkbook(app.baseUrl, OK_ID);
    assert.ok(worksheetNamed(kept, MAX_LENGTH_NAME));
  } finally {
    await app.stop();
  }
});

test("allows keeping a worksheet's own name whatever its letter case", async () => {
  const app = await startApp();
  try {
    const before = await getWorkbook(app.baseUrl, DUP_ID);
    const meridian = worksheetNamed(before, "Meridian");

    const same = await rename(app.baseUrl, DUP_ID, meridian.id, "MERIDIAN");
    assert.equal(same.status, 200);
    assert.equal(same.body.workbook.worksheets[0].name, "MERIDIAN");
  } finally {
    await app.stop();
  }
});

test("upgrades an existing data directory by adding the missing EVO worksheet-rename workbooks without dropping records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-sheet-upgrade-"));
  await mkdir(dataDir, { recursive: true });
  const previous = createSeedState().workbooks.find((workbook) => workbook.id === OK_ID);
  // Simulate an older store: the pre-provisioned EVO-M02 workbooks are absent
  // while a user workbook and a renamed worksheet record must survive.
  const renamed = {
    ...previous,
    worksheets: previous.worksheets.map((worksheet) =>
      worksheet.name === "HarborDraft" ? { ...worksheet, name: "Draft Renamed By User" } : worksheet,
    ),
  };
  const userWorkbook = {
    id: "user-wb-1",
    name: "My Ledger",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeWorksheetId: "user-ws-1",
    worksheets: [
      { id: "user-ws-1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "keep" } },
    ],
  };
  await writeFile(
    join(dataDir, "workbooks.json"),
    JSON.stringify({ workbooks: [renamed, userWorkbook] }, null, 2),
    "utf8",
  );

  const app = await startApp({ dataDir });
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const ids = list.body.workbooks.map((workbook) => workbook.id);
    for (const id of [OK_ID, DUP_ID, LIMIT_ID, "user-wb-1"]) {
      assert.ok(ids.includes(id), `${id} present after upgrade`);
    }
    // The user's renamed worksheet keeps its name; only the missing workbooks
    // were added.
    const ok = await getWorkbook(app.baseUrl, OK_ID);
    assert.ok(worksheetNamed(ok, "Draft Renamed By User"));
    assert.equal((await getWorkbook(app.baseUrl, "user-wb-1")).worksheets[0].cells.A1, "keep");

    const restarted = await app.restart();
    try {
      const after = await json(restarted.baseUrl, "/api/workbooks");
      const count = (id) => after.body.workbooks.filter((workbook) => workbook.id === id).length;
      for (const id of [OK_ID, DUP_ID, LIMIT_ID, "user-wb-1"]) {
        assert.equal(count(id), 1, `${id} appears exactly once`);
      }
      assert.equal(after.body.workbooks.some((workbook) => workbook.id === SEED_WORKBOOK_ID), true);
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});
