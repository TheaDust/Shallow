import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-ws-state-"));
  const store = createJsonStore(join(directory, "workbooks.json"), createSeedState());
  return { service: createWorkbookService(store), store, file: join(directory, "workbooks.json") };
}

async function startApp() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-ws-state-api-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-ws-state-static-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><main>app shell</main>", "utf8");
  const store = createJsonStore(join(dataDirectory, "workbooks.json"), createSeedState());
  const handler = createRequestHandler({ service: createWorkbookService(store), staticRoot });
  const server = createServer((request, response) => void handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("replacing a worksheet restores the recorded cells, used rectangle and grid size", async () => {
  const { service, file } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;

  // A later edit and a row insertion move the state away from the snapshot.
  await service.updateCells("q3-sales", sheet1, { C1: "=B2*2" });
  await service.changeStructure("q3-sales", sheet1, "row", { action: "insert-above", index: 0 });
  const moved = await service.get("q3-sales");
  // The inserted row moved C1 down and its reference with it.
  assert.equal(moved.worksheets[0].cells.C2, "=B3*2");

  const restored = await service.replaceWorksheet("q3-sales", sheet1, {
    cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" },
    rowCount: 50,
    columnCount: 26,
    usedRows: 3,
    usedCols: 2,
  });
  assert.deepEqual(restored.worksheets[0].cells, {
    A1: "Region",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
  });
  assert.equal(restored.worksheets[0].usedRows, 3);
  assert.equal(restored.worksheets[0].usedCols, 2);
  assert.equal(restored.worksheets[0].rowCount, 50);
  // The other worksheet is untouched by a single-worksheet restore.
  assert.deepEqual(restored.worksheets[1].cells, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.workbooks[0].worksheets[0].cells, restored.worksheets[0].cells);
});

test("a replace with an invalid coordinate rejects the whole payload", async () => {
  const { service, store } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;

  await assert.rejects(
    () => service.replaceWorksheet("q3-sales", sheet1, { cells: { A1: "Region", "1A": "boom" } }),
    /Invalid cell reference: 1A/,
  );

  const persisted = await store.read();
  assert.equal(persisted.workbooks[0].worksheets[0].cells.A1, "Region");
  assert.equal(persisted.workbooks[0].worksheets[0].cells["1A"], undefined);
});

test("a replace keeps the stored rules when the snapshot carries none", async () => {
  const { service, store } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;
  await store.update((draft) => {
    draft.workbooks[0].worksheets[0].validations = [
      { range: "D1:E2", type: "number-between", min: 0, max: 100 },
    ];
    return draft;
  });

  const kept = await service.replaceWorksheet("q3-sales", sheet1, { cells: { A1: "Region" } });
  assert.deepEqual(kept.worksheets[0].validations, [
    { range: "D1:E2", type: "number-between", min: 0, max: 100 },
  ]);

  const cleared = await service.replaceWorksheet("q3-sales", sheet1, {
    cells: { A1: "Region" },
    validations: [],
  });
  assert.deepEqual(cleared.worksheets[0].validations, []);
});

test("PUT /worksheets/:id replaces the worksheet state over HTTP", async () => {
  const app = await startApp();
  try {
    const sheet1 = (await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json())
      .workbook.worksheets[0].id;

    const response = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cells: { A1: "Region", D1: "East", E1: "1200", D2: "North", E2: "800" },
        rowCount: 50,
        columnCount: 26,
        usedRows: 2,
        usedCols: 5,
      }),
    });
    assert.equal(response.status, 200);
    const workbook = (await response.json()).workbook;
    assert.deepEqual(workbook.worksheets[0].cells, {
      A1: "Region",
      D1: "East",
      E1: "1200",
      D2: "North",
      E2: "800",
    });
    assert.equal(workbook.worksheets[0].usedCols, 5);

    const invalid = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/${sheet1}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { nope: "boom" } }),
    });
    assert.equal(invalid.status, 400);

    const after = (await (await fetch(`${app.baseUrl}/api/workbooks/q3-sales`)).json()).workbook;
    assert.deepEqual(after.worksheets[0].cells, workbook.worksheets[0].cells);

    const missing = await fetch(`${app.baseUrl}/api/workbooks/q3-sales/worksheets/nope`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cells: { A1: "x" } }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await app.stop();
  }
});
