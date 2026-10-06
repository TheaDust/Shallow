import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbooks of REQ-8-1-1, one per scenario. */
const CREATE = "wb-evo-n05-note-create";
const CREATE_SHEET = "ws-evo-n05-note-create-review-queue";
const EDIT = "wb-evo-n05-note-edit";
const EDIT_SHEET = "ws-evo-n05-note-edit-review-queue";
const DELETE = "wb-evo-n05-note-delete";
const DELETE_SHEET = "ws-evo-n05-note-delete-review-queue";

const CREATE_TEXT = "Confirm the harbor reference before release";
const EDIT_TEXT = "Awaiting controller sign-off";
const DELETE_TEXT = "Retire after audit";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-cell-note-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    /** Reopens the same data directory, as a browser refresh does. */
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
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

function send(baseUrl, method, path, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

const notesPath = (workbookId, worksheetId) =>
  `/api/workbooks/${workbookId}/worksheets/${worksheetId}/notes`;

function getWorkbook(baseUrl, id) {
  return json(baseUrl, `/api/workbooks/${id}`).then((response) => response.body.workbook);
}

function worksheetOf(workbook, worksheetId) {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

test("the pre-provisioned note workbooks carry their cells and seeded notes", async () => {
  const app = await startApp();
  try {
    const create = worksheetOf(await getWorkbook(app.baseUrl, CREATE), CREATE_SHEET);
    assert.equal(create.name, "ReviewQueue");
    assert.equal(create.cells.D8, "Manifest R41");
    assert.equal(create.notes, undefined);

    const edit = worksheetOf(await getWorkbook(app.baseUrl, EDIT), EDIT_SHEET);
    assert.equal(edit.name, "ReviewQueue");
    assert.equal(edit.cells.F6, "Gate Rho");
    assert.deepEqual(edit.notes, { F6: EDIT_TEXT });

    const remove = worksheetOf(await getWorkbook(app.baseUrl, DELETE), DELETE_SHEET);
    assert.equal(remove.name, "ReviewQueue");
    assert.equal(remove.cells.J3, "Route Zeta");
    assert.deepEqual(remove.notes, { J3: DELETE_TEXT });
  } finally {
    await app.stop();
  }
});

test("a saved note keeps the cell value and survives a restart", async () => {
  const app = await startApp();
  try {
    const saved = await send(app.baseUrl, "PUT", notesPath(CREATE, CREATE_SHEET), {
      coordinate: "d8",
      text: CREATE_TEXT,
    });
    assert.equal(saved.status, 200);
    const worksheet = worksheetOf(saved.body.workbook, CREATE_SHEET);
    assert.deepEqual(worksheet.notes, { D8: CREATE_TEXT });
    assert.equal(worksheet.cells.D8, "Manifest R41");
    assert.equal(worksheet.notes.D9, undefined);

    const restarted = await app.restart();
    try {
      const afterRestart = worksheetOf(await getWorkbook(restarted.baseUrl, CREATE), CREATE_SHEET);
      assert.deepEqual(afterRestart.notes, { D8: CREATE_TEXT });
      assert.equal(afterRestart.cells.D8, "Manifest R41");
    } finally {
      await restarted.stop();
    }
  } catch (error) {
    await app.stop();
    throw error;
  }
});

test("editing replaces the text of a stored note without touching the cell", async () => {
  const app = await startApp();
  try {
    const saved = await send(app.baseUrl, "PUT", notesPath(EDIT, EDIT_SHEET), {
      coordinate: "F6",
      text: "Controller signed at 14:20",
    });
    assert.equal(saved.status, 200);
    const worksheet = worksheetOf(saved.body.workbook, EDIT_SHEET);
    assert.deepEqual(worksheet.notes, { F6: "Controller signed at 14:20" });
    assert.equal(worksheet.cells.F6, "Gate Rho");

    const restarted = await app.restart();
    try {
      const afterRestart = worksheetOf(await getWorkbook(restarted.baseUrl, EDIT), EDIT_SHEET);
      assert.deepEqual(afterRestart.notes, { F6: "Controller signed at 14:20" });
      assert.equal(afterRestart.cells.F6, "Gate Rho");
    } finally {
      await restarted.stop();
    }
  } catch (error) {
    await app.stop();
    throw error;
  }
});

test("deleting removes the note and keeps the cell value", async () => {
  const app = await startApp();
  try {
    const removed = await send(app.baseUrl, "DELETE", notesPath(DELETE, DELETE_SHEET), { coordinate: "J3" });
    assert.equal(removed.status, 200);
    const worksheet = worksheetOf(removed.body.workbook, DELETE_SHEET);
    assert.equal(worksheet.notes, undefined);
    assert.equal(worksheet.cells.J3, "Route Zeta");

    const restarted = await app.restart();
    try {
      const afterRestart = worksheetOf(await getWorkbook(restarted.baseUrl, DELETE), DELETE_SHEET);
      assert.equal(afterRestart.notes, undefined);
      assert.equal(afterRestart.cells.J3, "Route Zeta");
    } finally {
      await restarted.stop();
    }
  } catch (error) {
    await app.stop();
    throw error;
  }
});

test("an empty text, an unknown coordinate and an unknown worksheet are rejected unchanged", async () => {
  const app = await startApp();
  try {
    const empty = await send(app.baseUrl, "PUT", notesPath(EDIT, EDIT_SHEET), { coordinate: "F6", text: "   " });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "Note text cannot be empty");

    const unknownCell = await send(app.baseUrl, "PUT", notesPath(EDIT, EDIT_SHEET), {
      coordinate: "not-a-cell",
      text: "text",
    });
    assert.equal(unknownCell.status, 400);
    assert.equal(unknownCell.body.error, "Unknown cell reference");

    const unknownSheet = await send(app.baseUrl, "PUT", notesPath(EDIT, "ws-missing"), {
      coordinate: "F6",
      text: "text",
    });
    assert.equal(unknownSheet.status, 400);

    const worksheet = worksheetOf(await getWorkbook(app.baseUrl, EDIT), EDIT_SHEET);
    assert.deepEqual(worksheet.notes, { F6: EDIT_TEXT });
    assert.equal(worksheet.cells.F6, "Gate Rho");
  } finally {
    await app.stop();
  }
});

test("a note follows its cell through row inserts and disappears with a deleted row", async () => {
  const app = await startApp();
  try {
    const structure = (mode, index) =>
      send(app.baseUrl, "POST", `/api/workbooks/${EDIT}/worksheets/${EDIT_SHEET}/structure`, {
        axis: "row",
        mode,
        index,
      });

    const inserted = await structure("insert-before", 6);
    assert.equal(inserted.status, 200);
    const afterInsert = worksheetOf(inserted.body.workbook, EDIT_SHEET);
    assert.deepEqual(afterInsert.notes, { F7: EDIT_TEXT });
    assert.equal(afterInsert.cells.F7, "Gate Rho");

    const deleted = await structure("delete", 7);
    assert.equal(deleted.status, 200);
    const afterDelete = worksheetOf(deleted.body.workbook, EDIT_SHEET);
    assert.equal(afterDelete.notes, undefined);
    assert.equal(afterDelete.cells.F6, undefined);
  } finally {
    await app.stop();
  }
});
