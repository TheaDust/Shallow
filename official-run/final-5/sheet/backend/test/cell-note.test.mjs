import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

async function startApp(dataDir) {
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-note-dist-"));
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

async function freshApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-note-"));
  return startApp(dataDir);
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(baseUrl, path, method, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function noteBase(workbookId) {
  return `/api/workbooks/${workbookId}/worksheets/${workbookId}--ReviewQueue/notes`;
}

test("the note workbooks are pre-provisioned with their values and notes", async () => {
  const app = await freshApp();
  try {
    const create = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-CREATE");
    assert.equal(create.status, 200);
    assert.equal(create.body.workbook.worksheets[0].name, "ReviewQueue");
    assert.equal(create.body.workbook.worksheets[0].cells.D8, "Manifest R41");
    assert.equal(create.body.workbook.worksheets[0].notes, undefined);

    const edit = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-EDIT");
    assert.equal(edit.body.workbook.worksheets[0].cells.F6, "Gate Rho");
    assert.deepEqual(edit.body.workbook.worksheets[0].notes, { F6: "Awaiting controller sign-off" });

    const remove = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-DELETE");
    assert.equal(remove.body.workbook.worksheets[0].cells.J3, "Route Zeta");
    assert.deepEqual(remove.body.workbook.worksheets[0].notes, { J3: "Retire after audit" });

    // The three scenario workbooks stay independent of one another.
    assert.deepEqual(create.body.workbook.worksheets[0].cells, { D8: "Manifest R41" });
  } finally {
    await app.stop();
  }
});

test("a created note is stored apart from the cell and survives a restart", async () => {
  const app = await freshApp();
  try {
    const saved = await send(app.baseUrl, noteBase("EVO-N05-NOTE-CREATE"), "PUT", {
      coordinate: "D8",
      text: "Confirm the harbor reference before release",
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.workbook.worksheets[0].notes, {
      D8: "Confirm the harbor reference before release",
    });
    // The annotated cell keeps its value.
    assert.equal(saved.body.workbook.worksheets[0].cells.D8, "Manifest R41");

    await app.restart();
    const again = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-CREATE");
    assert.deepEqual(again.body.workbook.worksheets[0].notes, {
      D8: "Confirm the harbor reference before release",
    });
    assert.equal(again.body.workbook.worksheets[0].cells.D8, "Manifest R41");
  } finally {
    await app.stop();
  }
});

test("editing replaces the text and deleting removes the note only", async () => {
  const app = await freshApp();
  try {
    const workbookId = "EVO-N05-NOTE-EDIT";
    const edited = await send(app.baseUrl, noteBase(workbookId), "PUT", {
      coordinate: "F6",
      text: "Controller signed at 14:20",
    });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.workbook.worksheets[0].notes, { F6: "Controller signed at 14:20" });
    assert.equal(edited.body.workbook.worksheets[0].cells.F6, "Gate Rho");

    await app.restart();
    const afterEdit = await json(app.baseUrl, `/api/workbooks/${workbookId}`);
    assert.deepEqual(afterEdit.body.workbook.worksheets[0].notes, { F6: "Controller signed at 14:20" });

    const removed = await send(app.baseUrl, noteBase("EVO-N05-NOTE-DELETE"), "DELETE", { coordinate: "J3" });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.workbook.worksheets[0].notes, undefined);
    assert.equal(removed.body.workbook.worksheets[0].cells.J3, "Route Zeta");

    await app.restart();
    const afterDelete = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-DELETE");
    assert.equal(afterDelete.body.workbook.worksheets[0].notes, undefined);
    assert.equal(afterDelete.body.workbook.worksheets[0].cells.J3, "Route Zeta");
    // The other scenario's note is untouched.
    const other = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-EDIT");
    assert.deepEqual(other.body.workbook.worksheets[0].notes, { F6: "Controller signed at 14:20" });
  } finally {
    await app.stop();
  }
});

test("malformed note requests are rejected without touching the stored state", async () => {
  const app = await freshApp();
  try {
    const base = "/api/workbooks/EVO-N05-NOTE-CREATE/worksheets/missing--ReviewQueue/notes";
    for (const [payload, message] of [
      [{ coordinate: "nope", text: "hello" }, "Unknown cell reference"],
      [{ coordinate: "D8", text: 7 }, "Invalid cell note"],
      [{ text: "hello" }, "Unknown cell reference"],
    ]) {
      const response = await send(app.baseUrl, noteBase("EVO-N05-NOTE-CREATE"), "PUT", payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, message);
    }
    const unknownWorksheet = await send(app.baseUrl, base, "PUT", { coordinate: "D8", text: "hello" });
    assert.equal(unknownWorksheet.status, 400);
    assert.equal(unknownWorksheet.body.error, "Unknown worksheet");
    const unknownWorkbook = await json(app.baseUrl, "/api/workbooks/nope/worksheets/nope/notes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: "D8", text: "hello" }),
    });
    assert.equal(unknownWorkbook.status, 404);

    const after = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-CREATE");
    assert.equal(after.body.workbook.worksheets[0].notes, undefined);
  } finally {
    await app.stop();
  }
});

test("a note follows its cell through an inserted row", async () => {
  const app = await freshApp();
  try {
    const created = await send(app.baseUrl, noteBase("EVO-N05-NOTE-CREATE"), "PUT", {
      coordinate: "D8",
      text: "Confirm the harbor reference before release",
    });
    assert.equal(created.status, 200);

    const shifted = await send(
      app.baseUrl,
      "/api/workbooks/EVO-N05-NOTE-CREATE/worksheets/EVO-N05-NOTE-CREATE--ReviewQueue/structure",
      "POST",
      { axis: "row", mode: "insert-before", index: 3 },
    );
    assert.equal(shifted.status, 200);
    assert.equal(shifted.body.workbook.worksheets[0].cells.D9, "Manifest R41");
    assert.deepEqual(shifted.body.workbook.worksheets[0].notes, {
      D9: "Confirm the harbor reference before release",
    });
  } finally {
    await app.stop();
  }
});

test("an existing data file gains the note workbooks once and keeps its records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-note-upgrade-"));
  // A stored state from before this feature: the baseline workbook was renamed
  // and edited by its user, and none of the note workbooks exist yet.
  await writeFile(
    join(dataDir, "workbooks.json"),
    JSON.stringify({
      workbooks: [
        {
          id: "wb-q3-sales",
          name: "Renamed Ledger",
          createdAt: "2026-09-21T09:00:00.000Z",
          updatedAt: "2026-09-28T14:05:00.000Z",
          activeWorksheetId: "ws-q3-sheet1",
          worksheets: [
            { id: "ws-q3-sheet1", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { A1: "kept" } },
          ],
        },
      ],
    }),
    "utf8",
  );
  const app = await startApp(dataDir);
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const names = list.body.workbooks.map((workbook) => workbook.name);
    for (const name of ["EVO-N05-NOTE-CREATE", "EVO-N05-NOTE-EDIT", "EVO-N05-NOTE-DELETE"]) {
      assert.ok(names.includes(name), name);
    }
    // The user's renamed workbook and its edited cell are untouched.
    const kept = await json(app.baseUrl, "/api/workbooks/wb-q3-sales");
    assert.equal(kept.body.workbook.name, "Renamed Ledger");
    assert.equal(kept.body.workbook.worksheets[0].cells.A1, "kept");
    const edit = await json(app.baseUrl, "/api/workbooks/EVO-N05-NOTE-EDIT");
    assert.deepEqual(edit.body.workbook.worksheets[0].notes, { F6: "Awaiting controller sign-off" });

    await app.restart();
    const again = await json(app.baseUrl, "/api/workbooks");
    assert.equal(again.body.workbooks.length, list.body.workbooks.length);
    const ids = again.body.workbooks.map((workbook) => workbook.id);
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    await app.stop();
  }
  const stored = JSON.parse(await readFile(join(dataDir, "workbooks.json"), "utf8"));
  assert.equal(stored.workbooks.filter((workbook) => workbook.id === "EVO-N05-NOTE-CREATE").length, 1);
});
