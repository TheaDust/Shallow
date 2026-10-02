import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSeedState, createWorkbookService } from "../src/domain/workbooks.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";

async function makeService() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-workbooks-"));
  const file = join(directory, "workbooks.json");
  const store = createJsonStore(file, createSeedState());
  return { service: createWorkbookService(store), file, store };
}

test("the evaluation seed exposes Q3 Sales with Sheet1 A1=Region", async () => {
  const { service } = await makeService();

  const summaries = await service.list();
  assert.deepEqual(summaries.map((summary) => summary.name), ["Q3 Sales"]);

  const workbook = await service.get("q3-sales");
  assert.equal(workbook.name, "Q3 Sales");
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1", "Sheet2"]);
  assert.equal(workbook.worksheets[0].cells.A1, "Region");
  assert.equal(workbook.worksheets[0].cells.B2, "1200");
  assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
  // The formula seed (REQ-4) of the same workbook keeps the source values and
  // the original expressions, which the grid derives results from.
  assert.deepEqual(workbook.worksheets[1].cells, {
    A1: "2",
    B1: "3",
    C1: "=A1+B1",
    D1: "=C1*2",
  });
});

test("the formula seed survives a store reload and keeps later user edits", async () => {
  const { service, file } = await makeService();
  const sheet2 = (await service.get("q3-sales")).worksheets[1].id;

  await service.updateCells("q3-sales", sheet2, { A1: "5" });

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  const worksheet = (await reloaded.get("q3-sales")).worksheets[1];
  assert.equal(worksheet.cells.A1, "5");
  assert.equal(worksheet.cells.C1, "=A1+B1");
  assert.equal(worksheet.cells.D1, "=C1*2");
});

test("creating a workbook stores a blank Sheet1 with A1 as the stored selection", async () => {
  const { service, file } = await makeService();

  const created = await service.create({ name: "  Budget plan  " });
  assert.equal(created.name, "Budget plan");
  assert.equal(created.id, "budget-plan");
  assert.deepEqual(created.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
  assert.deepEqual(created.worksheets[0].cells, {});
  assert.equal(created.activeWorksheetId, created.worksheets[0].id);
  assert.deepEqual(created.selections[created.worksheets[0].id],{
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  });

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.workbooks.length, 2);
  assert.equal(persisted.workbooks[1].name, "Budget plan");
});

test("creating without a name uses the default name and unique identifiers", async () => {
  const { service } = await makeService();

  const first = await service.create({});
  const second = await service.create({ name: "Untitled workbook" });
  assert.equal(first.name, "Untitled workbook");
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await service.list()).map((summary) => summary.name), [
    "Q3 Sales",
    "Untitled workbook",
    "Untitled workbook",
  ]);
});

test("a client id makes creation idempotent so a retried request does not duplicate", async () => {
  const { service, file } = await makeService();

  const first = await service.create({ id: "reload-proof-9a1b2c", name: "Reload proof" });
  assert.equal(first.id, "reload-proof-9a1b2c");
  assert.equal(first.name, "Reload proof");

  const retried = await service.create({ id: "reload-proof-9a1b2c", name: "Reload proof" });
  assert.equal(retried.id, first.id);
  assert.equal(retried.activeWorksheetId, first.activeWorksheetId);
  assert.deepEqual(retried.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);

  // An invalid client id is ignored and the normal slug path is used instead.
  const slugged = await service.create({ id: "not a valid id!", name: "Budget plan" });
  assert.equal(slugged.id, "budget-plan");

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(persisted.workbooks.map((workbook) => workbook.id), [
    "q3-sales",
    "reload-proof-9a1b2c",
    "budget-plan",
  ]);
});

test("renaming trims the name, bumps the timestamp and survives a store reload", async () => {
  const { service, file, store } = await makeService();

  const renamed = await service.rename("q3-sales", "  Q4 Forecast  ");
  assert.equal(renamed.name, "Q4 Forecast");
  assert.notEqual(renamed.updatedAt, "2026-09-29T09:15:00.000Z");

  const reloaded = createWorkbookService(createJsonStore(file, createSeedState()));
  assert.equal((await reloaded.get("q3-sales")).name, "Q4 Forecast");
  assert.equal((await store.read()).workbooks[0].name, "Q4 Forecast");
});

test("an empty workbook name is rejected and the stored record is untouched", async () => {
  const { service } = await makeService();

  await assert.rejects(() => service.rename("q3-sales", "   "), /Workbook name cannot be empty/);
  await assert.rejects(() => service.rename("q3-sales", ""), /Workbook name cannot be empty/);
  assert.equal((await service.get("q3-sales")).name, "Q3 Sales");
});

test("state updates keep active worksheet and the full selection rectangle without changing the timestamp", async () => {
  const { service } = await makeService();
  const workbook = await service.get("q3-sales");
  const sheet2 = workbook.worksheets[1].id;

  const updated = await service.updateState("q3-sales", {
    activeWorksheetId: sheet2,
    selection: { worksheetId: sheet2, anchor: { row: 4, col: 2 }, focus: { row: 1, col: 0 } },
  });
  assert.equal(updated.activeWorksheetId, sheet2);
  assert.deepEqual(updated.selections[sheet2], { anchor: { row: 4, col: 2 }, focus: { row: 1, col: 0 } });
  assert.equal(updated.updatedAt, "2026-09-29T09:15:00.000Z");
});

test("a legacy top-left selection stays valid and collapses to one cell", async () => {
  const { service } = await makeService();
  const workbook = await service.get("q3-sales");
  const sheet2 = workbook.worksheets[1].id;

  const updated = await service.updateState("q3-sales", {
    selection: { worksheetId: sheet2, row: 3, col: 1 },
  });
  assert.deepEqual(updated.selections[sheet2], { anchor: { row: 3, col: 1 }, focus: { row: 3, col: 1 } });
  // The other worksheet keeps its own stored selection.
  assert.deepEqual(updated.selections[workbook.worksheets[0].id], {
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  });

  await assert.rejects(
    () => service.updateState("q3-sales", { selection: { worksheetId: sheet2, row: -1, col: 0 } }),
    /Invalid selection/,
  );
});

test("cell updates validate coordinates and persist atomically", async () => {
  const { service, file } = await makeService();
  const sheet1 = (await service.get("q3-sales")).worksheets[0].id;

  const updated = await service.updateCells("q3-sales", sheet1, { A5: "  Total  ", B2: null });
  assert.equal(updated.worksheets[0].cells.A5, "  Total  ");
  assert.equal(updated.worksheets[0].cells.B2, undefined);
  assert.equal(updated.worksheets[0].cells.A1, "Region");

  await assert.rejects(() => service.updateCells("q3-sales", sheet1, { "1A": "x" }), /Invalid cell reference/);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.workbooks[0].worksheets[0].cells.A5, "  Total  ");
});

test("unknown workbooks and worksheets report not found", async () => {
  const { service } = await makeService();

  await assert.rejects(() => service.get("nope"), (error) => error.status === 404);
  await assert.rejects(() => service.updateCells("q3-sales", "nope", { A1: "x" }), (error) => error.status === 404);
});
