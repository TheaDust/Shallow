import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  INVALID_STRUCTURE_MESSAGE,
  SEED_SECOND_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
} from "../src/store/workbooks.mjs";

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-structure-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    restart() {
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
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

function send(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getWorkbook(baseUrl) {
  return (await json(baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`)).body.workbook;
}

function structureUrl(worksheetId = SEED_WORKSHEET_ID) {
  return `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/structure`;
}

async function setCell(baseUrl, coordinate, value, worksheetId = SEED_WORKSHEET_ID) {
  const result = await json(
    baseUrl,
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${worksheetId}/cells`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate, value }),
    },
  );
  assert.equal(result.status, 200);
}

async function setFormula(baseUrl, coordinate, formula) {
  await setCell(baseUrl, coordinate, formula);
}

test("inserting a row above the target shifts it and every later row down", async () => {
  const app = await startApp();
  try {
    const inserted = await json(
      app.baseUrl,
      structureUrl(),
      send({ axis: "row", mode: "insert-before", index: 2 }),
    );
    assert.equal(inserted.status, 200);
    const sheet1 = inserted.body.workbook.worksheets[0];
    assert.deepEqual(sheet1.cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A3: "East",
      B3: "1200",
      C3: "Open",
      A4: "North",
      B4: "800",
      C4: "Closed",
      A5: "South",
      B5: "700",
      C5: "Open",
    });
    // The untouched worksheet keeps its (empty) grid.
    assert.deepEqual(inserted.body.workbook.worksheets[1].cells, {});

    const restarted = await app.restart();
    try {
      const persisted = await getWorkbook(restarted.baseUrl);
      assert.equal(persisted.worksheets[0].cells.A2, undefined);
      assert.equal(persisted.worksheets[0].cells.A3, "East");
      assert.equal(persisted.worksheets[0].cells.B5, "700");
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("inserting a row below keeps the target and shifts the following rows down", async () => {
  const app = await startApp();
  try {
    const inserted = await json(
      app.baseUrl,
      structureUrl(),
      send({ axis: "row", mode: "insert-after", index: 2 }),
    );
    const cells = inserted.body.workbook.worksheets[0].cells;
    assert.equal(cells.A2, "East");
    assert.equal(cells.A3, undefined);
    assert.equal(cells.A4, "North");
    assert.equal(cells.A5, "South");
  } finally {
    await app.stop();
  }
});

test("deleting a row removes it, shifts later rows up and persists", async () => {
  const app = await startApp();
  try {
    await setFormula(app.baseUrl, "D1", "=B2");
    await setFormula(app.baseUrl, "E1", "=B3");

    const deleted = await json(app.baseUrl, structureUrl(), send({ axis: "row", mode: "delete", index: 2 }));
    assert.equal(deleted.status, 200);
    const cells = deleted.body.workbook.worksheets[0].cells;
    assert.equal(cells.A2, "North");
    assert.equal(cells.B2, "800");
    assert.equal(cells.A3, "South");
    assert.equal(cells.A4, undefined);
    // A reference to the deleted row cannot be kept; a later reference follows
    // its data upward.
    assert.equal(cells.D1, "=#REF!");
    assert.equal(cells.E1, "=B2");

    const targetWorksheet = deleted.body.workbook.worksheets[1];
    assert.deepEqual(targetWorksheet.cells, {});

    const restarted = await app.restart();
    try {
      const persisted = await getWorkbook(restarted.baseUrl);
      assert.equal(persisted.worksheets[0].cells.A2, "North");
      assert.equal(persisted.worksheets[0].cells.D1, "=#REF!");
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("row insertion rewrites kept references and ranges", async () => {
  const app = await startApp();
  try {
    await setFormula(app.baseUrl, "D1", "=B2+1");
    await setFormula(app.baseUrl, "D9", "=SUM(B2:B4)");

    const inserted = await json(
      app.baseUrl,
      structureUrl(),
      send({ axis: "row", mode: "insert-before", index: 2 }),
    );
    const cells = inserted.body.workbook.worksheets[0].cells;
    assert.equal(cells.D1, "=B3+1");
    assert.equal(cells.D10, "=SUM(B3:B5)");
  } finally {
    await app.stop();
  }
});

test("deleting a row shrinks a range that contained it", async () => {
  const app = await startApp();
  try {
    await setFormula(app.baseUrl, "D1", "=SUM(B2:B4)");
    const deleted = await json(app.baseUrl, structureUrl(), send({ axis: "row", mode: "delete", index: 3 }));
    assert.equal(deleted.body.workbook.worksheets[0].cells.D1, "=SUM(B2:B3)");  } finally {
    await app.stop();
  }
});

test("inserting a column left of the target shifts it and later columns right", async () => {
  const app = await startApp();
  try {
    const inserted = await json(
      app.baseUrl,
      structureUrl(),
      send({ axis: "column", mode: "insert-before", index: 2 }),
    );
    assert.equal(inserted.status, 200);
    const cells = inserted.body.workbook.worksheets[0].cells;
    assert.equal(cells.A1, "Region");
    assert.equal(cells.B1, undefined);
    assert.equal(cells.C1, "Sales");
    assert.equal(cells.D1, "Status");
    assert.equal(cells.C2, "1200");
  } finally {
    await app.stop();
  }
});

test("deleting a column preserves data outside it and marks direct references #REF!", async () => {
  const app = await startApp();
  try {
    await setFormula(app.baseUrl, "A10", "=B2");
    await setFormula(app.baseUrl, "A11", "=C2");

    const deleted = await json(app.baseUrl, structureUrl(), send({ axis: "column", mode: "delete", index: 2 }));
    assert.equal(deleted.status, 200);
    const cells = deleted.body.workbook.worksheets[0].cells;
    assert.equal(cells.A1, "Region");
    assert.equal(cells.B1, "Status");
    assert.equal(cells.C1, undefined);
    assert.equal(cells.B2, "Open");
    assert.equal(cells.A10, "=#REF!");
    // A reference to a column after the deleted one follows its data leftward.
    assert.equal(cells.A11, "=B2");
  } finally {
    await app.stop();
  }
});

test("a row change leaves other worksheets and the row menu of another sheet untouched", async () => {
  const app = await startApp();
  try {
    await setCell(app.baseUrl, "A2", "Only second sheet", SEED_SECOND_WORKSHEET_ID);
    await json(app.baseUrl, structureUrl(SEED_SECOND_WORKSHEET_ID), send({ axis: "row", mode: "delete", index: 1 }));
    const workbook = await getWorkbook(app.baseUrl);
    assert.deepEqual(workbook.worksheets[0].cells.A2, "East");
    assert.equal(workbook.worksheets[1].cells.A1, "Only second sheet");
  } finally {
    await app.stop();
  }
});

test("rejects malformed structure requests and keeps the stored grid unchanged", async () => {
  const app = await startApp();
  try {
    const badAxis = await json(app.baseUrl, structureUrl(), send({ axis: "diagonal", mode: "delete", index: 1 }));
    assert.equal(badAxis.status, 400);
    assert.equal(badAxis.body.error, INVALID_STRUCTURE_MESSAGE);

    const badMode = await json(app.baseUrl, structureUrl(), send({ axis: "row", mode: "shift", index: 1 }));
    assert.equal(badMode.status, 400);

    const badIndex = await json(app.baseUrl, structureUrl(), send({ axis: "row", mode: "delete", index: 0 }));
    assert.equal(badIndex.status, 400);

    const unknownWorksheet = await json(
      app.baseUrl,
      structureUrl("missing-worksheet"),
      send({ axis: "row", mode: "delete", index: 1 }),
    );
    assert.equal(unknownWorksheet.status, 400);

    const unknownWorkbook = await json(
      app.baseUrl,
      `/api/workbooks/missing/worksheets/${SEED_WORKSHEET_ID}/structure`,
      send({ axis: "row", mode: "delete", index: 1 }),
    );
    assert.equal(unknownWorkbook.status, 404);

    const workbook = await getWorkbook(app.baseUrl);
    assert.deepEqual(
      workbook.worksheets.map((worksheet) => worksheet.name),
      ["Sheet1", "Sheet2"],
    );
    assert.equal(workbook.worksheets[0].cells.A1, "Region");
    assert.equal(workbook.worksheets[0].cells.A2, "East");
    assert.equal(workbook.worksheets[0].cells.A4, "South");
  } finally {
    await app.stop();
  }
});
