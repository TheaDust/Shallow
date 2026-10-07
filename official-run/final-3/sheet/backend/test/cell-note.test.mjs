import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { EVOLUTION_WORKBOOK_SEEDS } from "../src/store/evolution-seed.mjs";

const CREATE_ID = "EVO-N05-NOTE-CREATE";
const EDIT_ID = "EVO-N05-NOTE-EDIT";
const DELETE_ID = "EVO-N05-NOTE-DELETE";
const NOTE_TEXT = "Confirm the harbor reference before release";

async function startApp(dataDir) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "shallowcode-note-")));
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

function noteUrl(workbookId, worksheetId) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/note`;
}

test("the seeded review queues hold their value and, where told, their note", async () => {
  const app = await startApp();
  try {
    const created = await worksheetOf(app.baseUrl, CREATE_ID);
    assert.equal(created.name, "ReviewQueue");
    assert.equal(created.cells.D8, "Manifest R41");
    assert.equal(created.notes, undefined);

    const edited = await worksheetOf(app.baseUrl, EDIT_ID);
    assert.equal(edited.name, "ReviewQueue");
    assert.equal(edited.cells.F6, "Gate Rho");
    assert.deepEqual(edited.notes, { F6: "Awaiting controller sign-off" });

    const deleted = await worksheetOf(app.baseUrl, DELETE_ID);
    assert.equal(deleted.name, "ReviewQueue");
    assert.equal(deleted.cells.J3, "Route Zeta");
    assert.deepEqual(deleted.notes, { J3: "Retire after audit" });
  } finally {
    await app.stop();
  }
});

test("a saved note keeps the cell value and survives a restart", async () => {
  const app = await startApp();
  const worksheet = await worksheetOf(app.baseUrl, CREATE_ID);
  try {
    const saved = await json(
      app.baseUrl,
      noteUrl(CREATE_ID, worksheet.id),
      send("PUT", { coordinate: "D8", text: NOTE_TEXT }),
    );
    assert.equal(saved.status, 200);
    const stored = saved.body.workbook.worksheets.find((candidate) => candidate.id === worksheet.id);
    assert.deepEqual(stored.notes, { D8: NOTE_TEXT });
    // The note annotates the cell: its stored text is untouched.
    assert.equal(stored.cells.D8, "Manifest R41");
    assert.equal(stored.notes.D8, NOTE_TEXT);
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, CREATE_ID);
    assert.deepEqual(worksheet.notes, { D8: NOTE_TEXT });
    assert.equal(worksheet.cells.D8, "Manifest R41");
  } finally {
    await restarted.stop();
  }
});

test("an edited note replaces its text in place without touching the cell", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, EDIT_ID);
    const saved = await json(
      app.baseUrl,
      noteUrl(EDIT_ID, worksheet.id),
      send("PUT", { coordinate: "F6", text: "Controller signed at 14:20" }),
    );
    assert.equal(saved.status, 200);
    const stored = saved.body.workbook.worksheets[0];
    assert.deepEqual(stored.notes, { F6: "Controller signed at 14:20" });
    assert.equal(stored.cells.F6, "Gate Rho");
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, EDIT_ID);
    assert.deepEqual(worksheet.notes, { F6: "Controller signed at 14:20" });
    assert.equal(worksheet.cells.F6, "Gate Rho");
  } finally {
    await restarted.stop();
  }
});

test("deleting a note removes it and keeps the cell value", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, DELETE_ID);
    const removed = await json(app.baseUrl, noteUrl(DELETE_ID, worksheet.id), send("DELETE", { coordinate: "J3" }));
    assert.equal(removed.status, 200);
    const stored = removed.body.workbook.worksheets[0];
    assert.equal(stored.notes, undefined);
    assert.equal(stored.cells.J3, "Route Zeta");

    // Deleting again changes nothing and is not an error.
    const again = await json(app.baseUrl, noteUrl(DELETE_ID, worksheet.id), send("DELETE", { coordinate: "J3" }));
    assert.equal(again.status, 200);
    assert.equal(again.body.workbook.worksheets[0].notes, undefined);
  } finally {
    await app.stop();
  }

  const restarted = await startApp(app.dataDir);
  try {
    const worksheet = await worksheetOf(restarted.baseUrl, DELETE_ID);
    assert.equal(worksheet.notes, undefined);
    assert.equal(worksheet.cells.J3, "Route Zeta");
  } finally {
    await restarted.stop();
  }
});

test("a rejected note request leaves every stored note as it was", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, EDIT_ID);
    const badCoordinate = await json(
      app.baseUrl,
      noteUrl(EDIT_ID, worksheet.id),
      send("PUT", { coordinate: "not-a-cell", text: "ignored" }),
    );
    assert.equal(badCoordinate.status, 400);
    assert.equal(badCoordinate.body.error, "Unknown cell reference");

    const badText = await json(
      app.baseUrl,
      noteUrl(EDIT_ID, worksheet.id),
      send("PUT", { coordinate: "F6", text: 7 }),
    );
    assert.equal(badText.status, 400);
    assert.equal(badText.body.error, "Note text must be a string");

    const unknownSheet = await json(
      app.baseUrl,
      noteUrl(EDIT_ID, "ws-does-not-exist"),
      send("DELETE", { coordinate: "F6" }),
    );
    assert.equal(unknownSheet.status, 400);

    const stored = await worksheetOf(app.baseUrl, EDIT_ID);
    assert.deepEqual(stored.notes, { F6: "Awaiting controller sign-off" });
    assert.equal(stored.cells.F6, "Gate Rho");
  } finally {
    await app.stop();
  }
});

test("only the addressed cell is annotated, so a second note leaves the first alone", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, CREATE_ID);
    await json(app.baseUrl, noteUrl(CREATE_ID, worksheet.id), send("PUT", { coordinate: "D8", text: NOTE_TEXT }));
    const second = await json(
      app.baseUrl,
      noteUrl(CREATE_ID, worksheet.id),
      send("PUT", { coordinate: "B2", text: "Second note" }),
    );
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.workbook.worksheets[0].notes, { D8: NOTE_TEXT, B2: "Second note" });

    const removed = await json(app.baseUrl, noteUrl(CREATE_ID, worksheet.id), send("DELETE", { coordinate: "B2" }));
    assert.deepEqual(removed.body.workbook.worksheets[0].notes, { D8: NOTE_TEXT });
  } finally {
    await app.stop();
  }
});

test("a row change moves a note with its cell and drops a note whose row is deleted", async () => {
  const app = await startApp();
  try {
    const worksheet = await worksheetOf(app.baseUrl, DELETE_ID);
    const inserted = await json(
      app.baseUrl,
      `/api/workbooks/${DELETE_ID}/worksheets/${worksheet.id}/structure`,
      send("POST", { axis: "row", mode: "insert-before", index: 1 }),
    );
    assert.equal(inserted.status, 200);
    assert.deepEqual(inserted.body.workbook.worksheets[0].notes, { J4: "Retire after audit" });
    assert.equal(inserted.body.workbook.worksheets[0].cells.J4, "Route Zeta");

    const deleted = await json(
      app.baseUrl,
      `/api/workbooks/${DELETE_ID}/worksheets/${worksheet.id}/structure`,
      send("POST", { axis: "row", mode: "delete", index: 4 }),
    );
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.workbook.worksheets[0].notes, undefined);
  } finally {
    await app.stop();
  }
});

test("an inherited store missing only this round's seeds gains them once and keeps user values", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-note-upgrade-"));
  // A store of the previous round: every earlier EVO workbook (one of them
  // renamed by the user) plus a user workbook, but none of the note seeds.
  const earlier = EVOLUTION_WORKBOOK_SEEDS.filter((seed) => !seed.id.startsWith("EVO-N05-"));
  assert.ok(earlier.length > 0);
  const renamed = structuredClone(earlier[0]);
  renamed.name = "EVO-M01-RENAME-OK renamed";
  const legacy = {
    workbooks: [
      ...earlier.map((seed, index) => (index === 0 ? renamed : seed)),
      {
        id: "wb-user-note",
        name: "My review",
        createdAt: "2026-10-07T09:00:00.000Z",
        updatedAt: "2026-10-07T09:00:00.000Z",
        activeWorksheetId: "ws-user-note",
        worksheets: [
          { id: "ws-user-note", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { C3: "kept" } },
        ],
      },
    ],
  };
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const app = await startApp(dataDir);
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.body.workbooks.length, EVOLUTION_WORKBOOK_SEEDS.length + 1);
    const seeded = await workbookOf(app.baseUrl, EDIT_ID);
    assert.equal(seeded.status, 200);
    assert.deepEqual(seeded.body.workbook.worksheets[0].notes, { F6: "Awaiting controller sign-off" });
    const kept = await workbookOf(app.baseUrl, "wb-user-note");
    assert.equal(kept.body.workbook.worksheets[0].cells.C3, "kept");
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
