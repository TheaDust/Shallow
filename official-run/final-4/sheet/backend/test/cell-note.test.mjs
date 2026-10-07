import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_NOTE_CREATE_WORKBOOK_ID,
  EVO_NOTE_CREATE_WORKSHEET_ID,
  EVO_NOTE_DELETE_WORKBOOK_ID,
  EVO_NOTE_DELETE_WORKSHEET_ID,
  EVO_NOTE_EDIT_WORKBOOK_ID,
  EVO_NOTE_EDIT_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
} from "../src/store/workbooks.mjs";

const CREATE_BASE = `/api/workbooks/${EVO_NOTE_CREATE_WORKBOOK_ID}/worksheets/${EVO_NOTE_CREATE_WORKSHEET_ID}`;
const EDIT_BASE = `/api/workbooks/${EVO_NOTE_EDIT_WORKBOOK_ID}/worksheets/${EVO_NOTE_EDIT_WORKSHEET_ID}`;
const DELETE_BASE = `/api/workbooks/${EVO_NOTE_DELETE_WORKBOOK_ID}/worksheets/${EVO_NOTE_DELETE_WORKSHEET_ID}`;

async function startApp({ state } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-cell-note-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-cell-note-dist-"));
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  await writeFile(join(staticRoot, "index.html"), '<!doctype html><div id="root"></div>', "utf8");
  if (state) await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
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

test("a stored note leaves the cell value alone and survives a restart", async () => {
  const app = await startApp();
  try {
    const created = await json(
      app.baseUrl,
      `${CREATE_BASE}/notes`,
      send("PUT", { coordinate: "D8", text: "Confirm the harbor reference before release" }),
    );
    assert.equal(created.status, 200);
    const worksheet = created.body.workbook.worksheets.find((entry) => entry.id === EVO_NOTE_CREATE_WORKSHEET_ID);
    assert.deepEqual(worksheet.notes, { D8: "Confirm the harbor reference before release" });
    // A note never rewrites the cell it is attached to.
    assert.deepEqual(worksheet.cells, { D8: "Manifest R41" });

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_NOTE_CREATE_WORKBOOK_ID, EVO_NOTE_CREATE_WORKSHEET_ID);
    assert.equal(persisted.notes.D8, "Confirm the harbor reference before release");
    assert.equal(persisted.cells.D8, "Manifest R41");
    await restarted.stop();

    // A second start of the same store neither loses the note nor reseeds it.
    const again = await app.restart();
    const repeated = await worksheetOf(again.baseUrl, EVO_NOTE_CREATE_WORKBOOK_ID, EVO_NOTE_CREATE_WORKSHEET_ID);
    assert.equal(repeated.notes.D8, "Confirm the harbor reference before release");
    const listing = await json(again.baseUrl, "/api/workbooks");
    assert.equal(
      listing.body.workbooks.filter((workbook) => workbook.id === EVO_NOTE_CREATE_WORKBOOK_ID).length,
      1,
    );
    await again.stop();
  } finally {
    await app.stop();
  }
});

test("an existing note is replaced in place and the cell keeps its value", async () => {
  const app = await startApp();
  try {
    const seeded = await worksheetOf(app.baseUrl, EVO_NOTE_EDIT_WORKBOOK_ID, EVO_NOTE_EDIT_WORKSHEET_ID);
    assert.deepEqual(seeded.notes, { F6: "Awaiting controller sign-off" });
    assert.equal(seeded.cells.F6, "Gate Rho");

    const edited = await json(
      app.baseUrl,
      `${EDIT_BASE}/notes`,
      send("PUT", { coordinate: "f6", text: "Controller signed at 14:20" }),
    );
    assert.equal(edited.status, 200);
    const replaced = edited.body.workbook.worksheets.find((entry) => entry.id === EVO_NOTE_EDIT_WORKSHEET_ID);
    assert.deepEqual(replaced.notes, { F6: "Controller signed at 14:20" });
    assert.equal(replaced.cells.F6, "Gate Rho");

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_NOTE_EDIT_WORKBOOK_ID, EVO_NOTE_EDIT_WORKSHEET_ID);
    assert.deepEqual(persisted.notes, { F6: "Controller signed at 14:20" });
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("deleting a note removes it and keeps the cell value", async () => {
  const app = await startApp();
  try {
    const seeded = await worksheetOf(app.baseUrl, EVO_NOTE_DELETE_WORKBOOK_ID, EVO_NOTE_DELETE_WORKSHEET_ID);
    assert.deepEqual(seeded.notes, { J3: "Retire after audit" });

    const deleted = await json(app.baseUrl, `${DELETE_BASE}/notes`, send("DELETE", { coordinate: "J3" }));
    assert.equal(deleted.status, 200);
    const cleared = deleted.body.workbook.worksheets.find((entry) => entry.id === EVO_NOTE_DELETE_WORKSHEET_ID);
    assert.equal(cleared.notes, undefined);
    assert.equal(cleared.cells.J3, "Route Zeta");

    const restarted = await app.restart();
    const persisted = await worksheetOf(restarted.baseUrl, EVO_NOTE_DELETE_WORKBOOK_ID, EVO_NOTE_DELETE_WORKSHEET_ID);
    assert.equal(persisted.notes, undefined);
    assert.equal(persisted.cells.J3, "Route Zeta");
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a malformed note payload is rejected and nothing is stored", async () => {
  const app = await startApp();
  try {
    const badCoordinate = await json(
      app.baseUrl,
      `${CREATE_BASE}/notes`,
      send("PUT", { coordinate: "not a cell", text: "note" }),
    );
    assert.equal(badCoordinate.status, 400);
    assert.equal(badCoordinate.body.error, "Invalid cell note");

    const emptyText = await json(
      app.baseUrl,
      `${CREATE_BASE}/notes`,
      send("PUT", { coordinate: "D8", text: "   " }),
    );
    assert.equal(emptyText.status, 400);
    assert.equal(emptyText.body.error, "Note text cannot be empty");

    const unknownWorksheet = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_NOTE_CREATE_WORKBOOK_ID}/worksheets/ws-missing/notes`,
      send("PUT", { coordinate: "D8", text: "note" }),
    );
    assert.equal(unknownWorksheet.status, 400);
    assert.equal(unknownWorksheet.body.error, "Unknown worksheet");

    const missingWorkbook = await json(
      app.baseUrl,
      "/api/workbooks/wb-missing/worksheets/ws-missing/notes",
      send("PUT", { coordinate: "D8", text: "note" }),
    );
    assert.equal(missingWorkbook.status, 404);

    const worksheet = await worksheetOf(app.baseUrl, EVO_NOTE_CREATE_WORKBOOK_ID, EVO_NOTE_CREATE_WORKSHEET_ID);
    assert.equal(worksheet.notes, undefined);
    assert.equal(worksheet.cells.D8, "Manifest R41");
  } finally {
    await app.stop();
  }
});

test("a note follows its cell through a row or column change", async () => {
  const app = await startApp();
  try {
    const inserted = await json(
      app.baseUrl,
      `${DELETE_BASE}/structure`,
      send("POST", { axis: "column", mode: "insert-before", index: 10 }),
    );
    assert.equal(inserted.status, 200);
    const moved = inserted.body.workbook.worksheets.find((entry) => entry.id === EVO_NOTE_DELETE_WORKSHEET_ID);
    assert.deepEqual(moved.notes, { K3: "Retire after audit" });
    assert.equal(moved.cells.K3, "Route Zeta");

    // Deleting the row the note sits on drops the note together with the cell.
    const removed = await json(
      app.baseUrl,
      `${DELETE_BASE}/structure`,
      send("POST", { axis: "row", mode: "delete", index: 3 }),
    );
    assert.equal(removed.status, 200);
    const cleared = removed.body.workbook.worksheets.find((entry) => entry.id === EVO_NOTE_DELETE_WORKSHEET_ID);
    assert.equal(cleared.notes, undefined);
    assert.equal(cleared.cells.K3, undefined);
  } finally {
    await app.stop();
  }
});

test("an existing store gains the note workbooks without losing stored records", async () => {
  // An older store: the shared evaluation seed plus one user workbook whose
  // name the visitor changed, and one workbook of an earlier round.
  const oldState = {
    workbooks: [
      {
        id: SEED_WORKBOOK_ID,
        name: "Q3 Sales (renamed by visitor)",
        createdAt: "2026-09-21T09:00:00.000Z",
        updatedAt: "2026-09-28T14:05:00.000Z",
        activeWorksheetId: "ws-q3-sheet1",
        worksheets: [
          {
            id: "ws-q3-sheet1",
            name: "Sheet1",
            selection: { anchor: "A1", focus: "A1" },
            cells: { A1: "Region", B1: "Sales", A2: "Visit edited" },
          },
        ],
      },
      {
        id: "wb-user-kept",
        name: "Visitor workbook",
        createdAt: "2026-09-29T09:00:00.000Z",
        updatedAt: "2026-09-30T09:00:00.000Z",
        activeWorksheetId: "ws-user-kept",
        worksheets: [{ id: "ws-user-kept", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: {} }],
      },
    ],
  };

  const app = await startApp({ state: oldState });
  try {
    const listing = await json(app.baseUrl, "/api/workbooks");
    const ids = listing.body.workbooks.map((workbook) => workbook.id);
    for (const expected of [
      EVO_NOTE_CREATE_WORKBOOK_ID,
      EVO_NOTE_EDIT_WORKBOOK_ID,
      EVO_NOTE_DELETE_WORKBOOK_ID,
    ]) {
      assert.equal(ids.filter((id) => id === expected).length, 1);
    }
    // The visitor's own workbook and the rename survive the upgrade.
    const kept = await json(app.baseUrl, "/api/workbooks/wb-user-kept");
    assert.equal(kept.status, 200);
    const renamed = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(renamed.body.workbook.name, "Q3 Sales (renamed by visitor)");
    assert.equal(renamed.body.workbook.worksheets[0].cells.A2, "Visit edited");

    // The pre-provisioned note of the edit scenario is there, and a restart
    // neither duplicates it nor drops a stored note.
    const seeded = await worksheetOf(app.baseUrl, EVO_NOTE_EDIT_WORKBOOK_ID, EVO_NOTE_EDIT_WORKSHEET_ID);
    assert.deepEqual(seeded.notes, { F6: "Awaiting controller sign-off" });

    const restarted = await app.restart();
    try {
      const restartedList = await json(restarted.baseUrl, "/api/workbooks");
      assert.equal(
        restartedList.body.workbooks.filter((workbook) => workbook.id === EVO_NOTE_EDIT_WORKBOOK_ID).length,
        1,
      );
      const note = await worksheetOf(restarted.baseUrl, EVO_NOTE_EDIT_WORKBOOK_ID, EVO_NOTE_EDIT_WORKSHEET_ID);
      assert.deepEqual(note.notes, { F6: "Awaiting controller sign-off" });
    } finally {
      await restarted.stop();
    }

    const onDisk = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    for (const expected of [
      EVO_NOTE_CREATE_WORKBOOK_ID,
      EVO_NOTE_EDIT_WORKBOOK_ID,
      EVO_NOTE_DELETE_WORKBOOK_ID,
    ]) {
      assert.equal(onDisk.workbooks.filter((workbook) => workbook.id === expected).length, 1);
    }
  } finally {
    await app.stop();
  }
});
