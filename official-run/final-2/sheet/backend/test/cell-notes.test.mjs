import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_NOTE_CREATE_ID,
  EVO_NOTE_CREATE_WORKSHEET_ID,
  EVO_NOTE_DELETE_ID,
  EVO_NOTE_DELETE_WORKSHEET_ID,
  EVO_NOTE_EDIT_ID,
  EVO_NOTE_EDIT_WORKSHEET_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-notes-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
    stop() {
      return new Promise((done) => server.close(done));
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(method, body) {
  return body === undefined
    ? { method, headers: { "content-type": "application/json" } }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function notesUrl(workbookId, worksheetId) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/notes`;
}

async function getWorkbook(baseUrl, workbookId) {
  const response = await json(baseUrl, `/api/workbooks/${workbookId}`);
  assert.equal(response.status, 200);
  return response.body.workbook;
}

function sheetOf(workbook) {
  return workbook.worksheets.find((sheet) => sheet.name === "ReviewQueue") ?? workbook.worksheets[0];
}

test("the seed pre-provisions the three cell note workbooks", () => {
  const state = createSeedState();
  const byId = (id) => state.workbooks.find((workbook) => workbook.id === id);

  const created = byId(EVO_NOTE_CREATE_ID);
  assert.equal(created.name, "EVO-N05-NOTE-CREATE");
  assert.equal(created.activeWorksheetId, EVO_NOTE_CREATE_WORKSHEET_ID);
  assert.equal(created.worksheets[0].name, "ReviewQueue");
  assert.deepEqual(created.worksheets[0].cells, { D8: "Manifest R41" });
  assert.equal(created.worksheets[0].notes, undefined);

  const edit = byId(EVO_NOTE_EDIT_ID);
  assert.equal(edit.name, "EVO-N05-NOTE-EDIT");
  assert.equal(edit.activeWorksheetId, EVO_NOTE_EDIT_WORKSHEET_ID);
  assert.deepEqual(edit.worksheets[0].cells, { F6: "Gate Rho" });
  assert.deepEqual(edit.worksheets[0].notes, { F6: "Awaiting controller sign-off" });

  const remove = byId(EVO_NOTE_DELETE_ID);
  assert.equal(remove.name, "EVO-N05-NOTE-DELETE");
  assert.equal(remove.activeWorksheetId, EVO_NOTE_DELETE_WORKSHEET_ID);
  assert.deepEqual(remove.worksheets[0].cells, { J3: "Route Zeta" });
  assert.deepEqual(remove.worksheets[0].notes, { J3: "Retire after audit" });
});

test("saving a note keeps the cell value and survives a restart", async () => {
  const app = await startApp();
  try {
    const saved = await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_CREATE_ID, EVO_NOTE_CREATE_WORKSHEET_ID),
      send("PUT", { coordinate: "D8", text: "Confirm the harbor reference before release" }),
    );
    assert.equal(saved.status, 200);
    const sheet = sheetOf(saved.body.workbook);
    assert.deepEqual(sheet.notes, { D8: "Confirm the harbor reference before release" });
    assert.deepEqual(sheet.cells, { D8: "Manifest R41" });

    const restarted = await app.restart();
    const reloaded = sheetOf(await getWorkbook(restarted.baseUrl, EVO_NOTE_CREATE_ID));
    assert.deepEqual(reloaded.notes, { D8: "Confirm the harbor reference before release" });
    assert.deepEqual(reloaded.cells, { D8: "Manifest R41" });
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("editing a note replaces its text and keeps the cell value", async () => {
  const app = await startApp();
  try {
    const saved = await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_EDIT_ID, EVO_NOTE_EDIT_WORKSHEET_ID),
      send("PUT", { coordinate: "f6", text: "Controller signed at 14:20" }),
    );
    assert.equal(saved.status, 200);
    const sheet = sheetOf(saved.body.workbook);
    assert.deepEqual(sheet.notes, { F6: "Controller signed at 14:20" });
    assert.deepEqual(sheet.cells, { F6: "Gate Rho" });

    const restarted = await app.restart();
    const reloaded = sheetOf(await getWorkbook(restarted.baseUrl, EVO_NOTE_EDIT_ID));
    assert.deepEqual(reloaded.notes, { F6: "Controller signed at 14:20" });
    assert.deepEqual(reloaded.cells, { F6: "Gate Rho" });
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("deleting a note removes it and keeps the cell value", async () => {
  const app = await startApp();
  try {
    const removed = await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_DELETE_ID, EVO_NOTE_DELETE_WORKSHEET_ID),
      send("DELETE", { coordinate: "J3" }),
    );
    assert.equal(removed.status, 200);
    const sheet = sheetOf(removed.body.workbook);
    assert.equal(sheet.notes, undefined);
    assert.deepEqual(sheet.cells, { J3: "Route Zeta" });

    const restarted = await app.restart();
    const reloaded = sheetOf(await getWorkbook(restarted.baseUrl, EVO_NOTE_DELETE_ID));
    assert.equal(reloaded.notes, undefined);
    assert.deepEqual(reloaded.cells, { J3: "Route Zeta" });
    await restarted.stop();
  } finally {
    await app.stop();
  }
});

test("a note of one cell never touches another cell, sheet or workbook", async () => {
  const app = await startApp();
  try {
    const created = await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_CREATE_ID, EVO_NOTE_CREATE_WORKSHEET_ID),
      send("PUT", { coordinate: "D8", text: "Confirm the harbor reference before release" }),
    );
    assert.equal(created.status, 200);
    // The other scenario workbooks keep their own notes at the same coordinates.
    const edited = await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_EDIT_ID, EVO_NOTE_EDIT_WORKSHEET_ID),
      send("PUT", { coordinate: "D8", text: "Second sheet note" }),
    );
    const editSheet = sheetOf(edited.body.workbook);
    assert.deepEqual(editSheet.notes, { F6: "Awaiting controller sign-off", D8: "Second sheet note" });
    assert.equal(editSheet.cells.D8, undefined);

    const reloadedCreate = sheetOf(await getWorkbook(app.baseUrl, EVO_NOTE_CREATE_ID));
    assert.deepEqual(reloadedCreate.notes, { D8: "Confirm the harbor reference before release" });
    const reloadedDelete = sheetOf(await getWorkbook(app.baseUrl, EVO_NOTE_DELETE_ID));
    assert.deepEqual(reloadedDelete.notes, { J3: "Retire after audit" });
  } finally {
    await app.stop();
  }
});

test("an empty or malformed note is rejected without changing the stored notes", async () => {
  const app = await startApp();
  try {
    const payloads = [
      { coordinate: "F6", text: "" },
      { coordinate: "F6", text: "   " },
      { coordinate: "F6" },
      { coordinate: "nonsense", text: "Held" },
    ];
    for (const payload of payloads) {
      const rejected = await json(
        app.baseUrl,
        notesUrl(EVO_NOTE_EDIT_ID, EVO_NOTE_EDIT_WORKSHEET_ID),
        send("PUT", payload),
      );
      assert.equal(rejected.status, 400, JSON.stringify(payload));
    }
    const badCell = await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_EDIT_ID, EVO_NOTE_EDIT_WORKSHEET_ID),
      send("DELETE", { coordinate: "nope" }),
    );
    assert.equal(badCell.status, 400);

    const unknownWorkbook = await json(
      app.baseUrl,
      notesUrl("wb-missing", EVO_NOTE_EDIT_WORKSHEET_ID),
      send("PUT", { coordinate: "F6", text: "Held" }),
    );
    assert.equal(unknownWorkbook.status, 404);

    const sheet = sheetOf(await getWorkbook(app.baseUrl, EVO_NOTE_EDIT_ID));
    assert.deepEqual(sheet.notes, { F6: "Awaiting controller sign-off" });
    assert.deepEqual(sheet.cells, { F6: "Gate Rho" });
  } finally {
    await app.stop();
  }
});

test("a note follows its cell when a row or column is inserted", async () => {
  const app = await startApp();
  try {
    await json(
      app.baseUrl,
      notesUrl(EVO_NOTE_CREATE_ID, EVO_NOTE_CREATE_WORKSHEET_ID),
      send("PUT", { coordinate: "D8", text: "Confirm the harbor reference before release" }),
    );
    const inserted = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_NOTE_CREATE_ID}/worksheets/${EVO_NOTE_CREATE_WORKSHEET_ID}/structure`,
      send("POST", { axis: "row", mode: "insert-before", index: 3 }),
    );
    assert.equal(inserted.status, 200);
    const shifted = sheetOf(inserted.body.workbook);
    assert.deepEqual(shifted.notes, { D9: "Confirm the harbor reference before release" });
    assert.equal(shifted.cells.D9, "Manifest R41");

    const deleted = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_NOTE_CREATE_ID}/worksheets/${EVO_NOTE_CREATE_WORKSHEET_ID}/structure`,
      send("POST", { axis: "row", mode: "delete", index: 9 }),
    );
    assert.equal(deleted.status, 200);
    const dropped = sheetOf(deleted.body.workbook);
    assert.equal(dropped.notes, undefined);
    assert.equal(dropped.cells.D9, undefined);
  } finally {
    await app.stop();
  }
});

test("clearing the cell keeps its note, and the note keeps being readable", async () => {
  const app = await startApp();
  try {
    const cleared = await json(
      app.baseUrl,
      `/api/workbooks/${EVO_NOTE_DELETE_ID}/worksheets/${EVO_NOTE_DELETE_WORKSHEET_ID}/cells`,
      send("PATCH", { coordinate: "J3", value: "" }),
    );
    assert.equal(cleared.status, 200);
    const sheet = sheetOf(cleared.body.workbook);
    assert.deepEqual(sheet.cells, {});
    assert.deepEqual(sheet.notes, { J3: "Retire after audit" });
  } finally {
    await app.stop();
  }
});
