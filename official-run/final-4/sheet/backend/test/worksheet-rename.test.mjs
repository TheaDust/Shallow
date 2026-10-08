import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  DUPLICATE_WORKSHEET_NAME_MESSAGE,
  EMPTY_WORKSHEET_NAME_MESSAGE,
  EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID,
  EVO_SHEET_DUP_MERIDIAN_WORKSHEET_ID,
  EVO_SHEET_DUP_WORKBOOK_ID,
  EVO_SHEET_LIMIT_WORKBOOK_ID,
  EVO_SHEET_LIMIT_WORKSHEET_ID,
  EVO_SHEET_OK_HARBOR_WORKSHEET_ID,
  EVO_SHEET_OK_WORKBOOK_ID,
  LONG_WORKSHEET_NAME_MESSAGE,
  WORKSHEET_NAME_MAX_LENGTH,
  createSeedState,
} from "../src/store/workbooks.mjs";

/** The 51-character value of the length scenario. */
const TOO_LONG_NAME = "B".repeat(51);
/** A 50-character name, the longest one accepted after trimming. */
const MAX_LENGTH_NAME = "B".repeat(WORKSHEET_NAME_MAX_LENGTH);

async function startApp({ state } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-sheet-rename-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  if (state) await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    staticRoot,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    /** Second server on the same data directory, as after a restart. */
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        async stop() {
          await new Promise((done) => restarted.close(done));
        },
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function rename(baseUrl, workbookId, worksheetId, name) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

function detail(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${encodeURIComponent(id)}`);
}

function names(workbook) {
  return workbook.worksheets.map((worksheet) => worksheet.name);
}

test("pre-provisions the worksheet-rename workbooks with their tabs, active sheet and sentinel cells", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const entries = list.body.workbooks;
    for (const expected of [EVO_SHEET_OK_WORKBOOK_ID, EVO_SHEET_DUP_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKBOOK_ID]) {
      assert.ok(
        entries.some((entry) => entry.name === expected),
        `missing pre-provisioned workbook ${expected}`,
      );
    }

    const ok = await detail(app.baseUrl, EVO_SHEET_OK_WORKBOOK_ID);
    assert.equal(ok.status, 200);
    assert.deepEqual(names(ok.body.workbook), ["HarborDraft", "LedgerView"]);
    assert.equal(ok.body.workbook.activeWorksheetId, EVO_SHEET_OK_HARBOR_WORKSHEET_ID);
    const harbor = ok.body.workbook.worksheets[0];
    assert.equal(harbor.id, EVO_SHEET_OK_HARBOR_WORKSHEET_ID);
    assert.equal(harbor.cells.D5, "dock marker");

    const duplicate = await detail(app.baseUrl, EVO_SHEET_DUP_WORKBOOK_ID);
    assert.deepEqual(names(duplicate.body.workbook), ["Meridian", "ArchiveBay"]);
    assert.equal(duplicate.body.workbook.activeWorksheetId, EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID);
    assert.equal(duplicate.body.workbook.worksheets[0].id, EVO_SHEET_DUP_MERIDIAN_WORKSHEET_ID);

    const limit = await detail(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID);
    assert.deepEqual(names(limit.body.workbook), ["LengthGauge"]);
    assert.equal(limit.body.workbook.activeWorksheetId, EVO_SHEET_LIMIT_WORKSHEET_ID);
    assert.equal(limit.body.workbook.worksheets[0].cells.G4, "sheet sentinel");
  } finally {
    await app.stop();
  }
});

test("trims an available worksheet name, keeps the tab active and its cell after a restart", async () => {
  const app = await startApp();
  try {
    const renamed = await rename(app.baseUrl, EVO_SHEET_OK_WORKBOOK_ID, EVO_SHEET_OK_HARBOR_WORKSHEET_ID, "  Dispatch Register  ");
    assert.equal(renamed.status, 200);
    assert.deepEqual(names(renamed.body.workbook), ["Dispatch Register", "LedgerView"]);
    assert.equal(renamed.body.workbook.activeWorksheetId, EVO_SHEET_OK_HARBOR_WORKSHEET_ID);
    assert.equal(renamed.body.workbook.worksheets[0].cells.D5, "dock marker");
    // Renaming one worksheet of the workbook leaves the other one as it was.
    assert.equal(renamed.body.workbook.worksheets[1].name, "LedgerView");

    const restarted = await app.restart();
    try {
      const persisted = await detail(restarted.baseUrl, EVO_SHEET_OK_WORKBOOK_ID);
      assert.deepEqual(names(persisted.body.workbook), ["Dispatch Register", "LedgerView"]);
      assert.equal(persisted.body.workbook.activeWorksheetId, EVO_SHEET_OK_HARBOR_WORKSHEET_ID);
      assert.equal(persisted.body.workbook.worksheets[0].cells.D5, "dock marker");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("rejects a worksheet name that differs only by letter case and keeps the active tab", async () => {
  const app = await startApp();
  try {
    for (const attempted of ["meridian", "MERIDIAN", "MeRiDiAn"]) {
      const rejected = await rename(
        app.baseUrl,
        EVO_SHEET_DUP_WORKBOOK_ID,
        EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID,
        attempted,
      );
      assert.equal(rejected.status, 400, `${attempted} must be rejected`);
      assert.equal(rejected.body.error, DUPLICATE_WORKSHEET_NAME_MESSAGE);
      const kept = await detail(app.baseUrl, EVO_SHEET_DUP_WORKBOOK_ID);
      assert.deepEqual(names(kept.body.workbook), ["Meridian", "ArchiveBay"]);
      assert.equal(kept.body.workbook.activeWorksheetId, EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID);
    }

    // A name that only changes the case of the worksheet's own name is fine.
    const accepted = await rename(
      app.baseUrl,
      EVO_SHEET_DUP_WORKBOOK_ID,
      EVO_SHEET_DUP_ARCHIVE_WORKSHEET_ID,
      "ARCHIVEBAY",
    );
    assert.equal(accepted.status, 200);
    assert.deepEqual(names(accepted.body.workbook), ["Meridian", "ARCHIVEBAY"]);
  } finally {
    await app.stop();
  }
});

test("accepts 50 characters and rejects 51 characters with the length message", async () => {
  const app = await startApp();
  try {
    const longest = await rename(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKSHEET_ID, MAX_LENGTH_NAME);
    assert.equal(longest.status, 200);
    assert.equal(longest.body.workbook.worksheets[0].name, MAX_LENGTH_NAME);

    const tooLong = await rename(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKSHEET_ID, TOO_LONG_NAME);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, LONG_WORKSHEET_NAME_MESSAGE);

    const restarted = await app.restart();
    try {
      const persisted = await detail(restarted.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID);
      assert.equal(persisted.body.workbook.worksheets[0].name, MAX_LENGTH_NAME);
      assert.equal(persisted.body.workbook.worksheets[0].cells.G4, "sheet sentinel");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("allows a name another workbook already uses, since uniqueness is per workbook", async () => {
  const app = await startApp();
  try {
    // `HarborDraft` belongs to EVO-M02-SHEET-OK, a different workbook.
    const taken = await rename(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKSHEET_ID, "harbordraft");
    assert.equal(taken.status, 200);
    const detailAfter = await detail(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID);
    assert.deepEqual(names(detailAfter.body.workbook), ["harbordraft"]);
    assert.equal(detailAfter.body.workbook.worksheets[0].cells.G4, "sheet sentinel");
    // The other workbook keeps its own worksheet name.
    const other = await detail(app.baseUrl, EVO_SHEET_OK_WORKBOOK_ID);
    assert.deepEqual(names(other.body.workbook), ["HarborDraft", "LedgerView"]);
  } finally {
    await app.stop();
  }
});

test("rejects an empty or whitespace-only worksheet name and an unknown worksheet", async () => {
  const app = await startApp();
  try {
    for (const attempted of ["", "   "]) {
      const rejected = await rename(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKSHEET_ID, attempted);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, EMPTY_WORKSHEET_NAME_MESSAGE);
    }
    const unknown = await rename(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID, "no-such-worksheet", "Anything");
    assert.equal(unknown.status, 400);
    const missingWorkbook = await rename(app.baseUrl, "no-such-workbook", EVO_SHEET_LIMIT_WORKSHEET_ID, "Anything");
    assert.equal(missingWorkbook.status, 404);

    const kept = await detail(app.baseUrl, EVO_SHEET_LIMIT_WORKBOOK_ID);
    assert.deepEqual(names(kept.body.workbook), ["LengthGauge"]);
    assert.equal(kept.body.workbook.worksheets[0].cells.G4, "sheet sentinel");
  } finally {
    await app.stop();
  }
});

test("upgrades an older store with the missing worksheet-rename workbooks only once", async () => {
  // A store written before this round: the baseline workbook with a user rename
  // and the earlier round's pre-provisioned workbooks, but none of the M02 ones.
  const legacy = createSeedState();
  legacy.workbooks = legacy.workbooks.filter(
    (workbook) =>
      workbook.id !== EVO_SHEET_OK_WORKBOOK_ID &&
      workbook.id !== EVO_SHEET_DUP_WORKBOOK_ID &&
      workbook.id !== EVO_SHEET_LIMIT_WORKBOOK_ID,
  );
  const baseline = legacy.workbooks.find((workbook) => workbook.id === "wb-q3-sales");
  baseline.name = "My Ledger";
  baseline.worksheets[0].cells.A1 = "Region edited";
  legacy.workbooks.push({
    id: "user-workbook-1",
    name: "My own workbook",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:05:00.000Z",
    activeWorksheetId: "user-worksheet-1",
    worksheets: [{ id: "user-worksheet-1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: {} }],
  });

  const app = await startApp({ state: legacy });
  try {
    const first = await json(app.baseUrl, "/api/workbooks");
    const ids = first.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "upgrade must not duplicate workbooks");
    for (const expected of [EVO_SHEET_OK_WORKBOOK_ID, EVO_SHEET_DUP_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKBOOK_ID]) {
      assert.ok(ids.includes(expected), `upgrade must add ${expected}`);
    }
    assert.ok(ids.includes("user-workbook-1"));
    const renamedBaseline = first.body.workbooks.find((entry) => entry.id === "wb-q3-sales");
    assert.equal(renamedBaseline.name, "My Ledger");

    const upgraded = await detail(app.baseUrl, EVO_SHEET_OK_WORKBOOK_ID);
    assert.deepEqual(names(upgraded.body.workbook), ["HarborDraft", "LedgerView"]);
    assert.equal(upgraded.body.workbook.worksheets[0].cells.D5, "dock marker");

    const restarted = await app.restart();
    try {
      const second = await json(restarted.baseUrl, "/api/workbooks");
      const secondIds = second.body.workbooks.map((entry) => entry.id);
      assert.equal(new Set(secondIds).size, secondIds.length);
      assert.equal(secondIds.length, first.body.workbooks.length);
      const persistedBaseline = await detail(restarted.baseUrl, "wb-q3-sales");
      assert.equal(persistedBaseline.body.workbook.name, "My Ledger");
      assert.equal(persistedBaseline.body.workbook.worksheets[0].cells.A1, "Region edited");
      assert.equal(persistedBaseline.body.workbook.worksheets.length, 2);
    } finally {
      await restarted.stop();
    }

    const onDisk = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    for (const expected of [EVO_SHEET_OK_WORKBOOK_ID, EVO_SHEET_DUP_WORKBOOK_ID, EVO_SHEET_LIMIT_WORKBOOK_ID]) {
      assert.equal(onDisk.workbooks.filter((workbook) => workbook.id === expected).length, 1);
    }
  } finally {
    await app.stop();
  }
});
