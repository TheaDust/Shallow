import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createJsonStore } from "../src/lib/json-store.mjs";
import { createInitialState } from "../src/lib/seed.mjs";

/** Starts the real request handler against a temporary state file. */
async function startApi(mutateState) {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-data-"));
  const statePath = join(directory, "workbooks.json");
  const state = createInitialState();
  if (mutateState) mutateState(state);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const store = createJsonStore(statePath, createInitialState());
  const handler = createRequestHandler({ store, staticRoot: join(directory, "no-dist") });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const api = async (path, init = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      method: init.method ?? "GET",
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  return {
    api,
    async restart() {
      const restarted = createJsonStore(statePath, createInitialState());
      const newHandler = createRequestHandler({ store: restarted, staticRoot: join(directory, "no-dist") });
      const newServer = createServer(newHandler);
      await new Promise((resolve) => newServer.listen(0, "127.0.0.1", resolve));
      const { port: newPort } = newServer.address();
      return {
        get: async (path) => {
          const response = await fetch(`http://127.0.0.1:${newPort}${path}`);
          return { status: response.status, body: await response.json() };
        },
        close: async () => {
          newServer.closeAllConnections?.();
          await new Promise((resolve) => newServer.close(resolve));
        },
      };
    },
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const SHEET1 = "ws-q3-sales-sheet1";

function sheet1(workbook) {
  return workbook.worksheets.find((sheet) => sheet.id === SHEET1);
}

const request = (api) => ({
  createFilter: (range) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/filters`, {
    method: "POST",
    body: JSON.stringify({ range }),
  }),
  clearFilter: () => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/filters`, { method: "DELETE" }),
  setColumnFilter: (filterId, column, condition) =>
    api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/filters/${filterId}/columns/${column}`, {
      method: "PUT",
      body: JSON.stringify({ condition }),
    }),
  saveValidation: (rule) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/validations`, {
    method: "POST",
    body: JSON.stringify(rule),
  }),
  deleteValidation: (ruleId) =>
    api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/validations/${ruleId}`, { method: "DELETE" }),
  cell: (cell, value) => api.api("/api/workbooks/wb-q3-sales/cells", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: SHEET1, cell, value }),
  }),
  paste: (start, text) => api.api("/api/workbooks/wb-q3-sales/paste", {
    method: "PUT",
    body: JSON.stringify({ worksheetId: SHEET1, start, text }),
  }),
  transfer: (body) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/range-transfer`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
  rows: (body) => api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/rows`, {
    method: "POST",
    body: JSON.stringify(body),
  }),
});

test("creates a filter view for the selected region, edits a column and clears it again", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const created = await run.createFilter({ start: "A1", end: "C4" });
  assert.equal(created.status, 200);
  const filter = sheet1(created.body.workbook).filters[0];
  assert.deepEqual(filter.range, { start: "A1", end: "C4" });
  assert.deepEqual(filter.conditions, []);
  // Creating a filter never rewrites a record.
  assert.equal(sheet1(created.body.workbook).cells.A1, "Region");
  assert.equal(sheet1(created.body.workbook).cells.A4, "South");

  const values = await run.setColumnFilter(filter.id, "A", { kind: "values", values: ["East"] });
  assert.equal(values.status, 200);
  assert.deepEqual(sheet1(values.body.workbook).filters[0].conditions, [
    { column: "A", kind: "values", values: ["East"] },
  ]);

  const combined = await run.setColumnFilter(filter.id, "B", {
    kind: "condition",
    operator: "greater-than",
    value: "750",
  });
  assert.equal(combined.status, 200);
  assert.deepEqual(sheet1(combined.body.workbook).filters[0].conditions, [
    { column: "A", kind: "values", values: ["East"] },
    { column: "B", kind: "condition", operator: "greater-than", value: "750" },
  ]);

  // The next condition of the same column replaces the previous one.
  const replaced = await run.setColumnFilter(filter.id, "A", {
    kind: "condition",
    operator: "text-contains",
    value: "th",
  });
  assert.deepEqual(sheet1(replaced.body.workbook).filters[0].conditions, [
    { column: "B", kind: "condition", operator: "greater-than", value: "750" },
    { column: "A", kind: "condition", operator: "text-contains", value: "th" },
  ]);

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await restarted.get("/api/workbooks/wb-q3-sales");
  assert.equal(sheet1(reopened.body.workbook).filters[0].range.start, "A1");
  assert.equal(sheet1(reopened.body.workbook).filters[0].conditions.length, 2);

  const cleared = await run.clearFilter();
  assert.equal(cleared.status, 200);
  assert.deepEqual(sheet1(cleared.body.workbook).filters, []);
  // Clearing the filter leaves every record and every value untouched.
  assert.equal(sheet1(cleared.body.workbook).cells.A2, "East");
  assert.equal(sheet1(cleared.body.workbook).cells.C4, "Open");
});

test("refuses a malformed filter condition without writing anything", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const missingRange = await run.createFilter({ start: "nope", end: "C4" });
  assert.equal(missingRange.status, 400);
  assert.equal(missingRange.body.error, "Invalid range");

  const created = await run.createFilter({ start: "A1", end: "C4" });
  const createdId = sheet1(created.body.workbook).filters[0].id;
  const badOperator = await run.setColumnFilter(createdId, "A", { kind: "condition", operator: "roughly", value: "1" });
  assert.equal(badOperator.status, 400);
  assert.equal(badOperator.body.error, "Invalid filter condition");
  const unknownFilter = await run.setColumnFilter("filter-missing", "A", { kind: "values", values: [] });
  assert.equal(unknownFilter.status, 404);
});

test("refuses a 0-to-100 write outside the range and keeps the inclusive boundaries", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const saved = await run.saveValidation({ type: "number-range", range: { start: "B2", end: "B4" }, min: "0", max: "100" });
  assert.equal(saved.status, 200);
  const rule = sheet1(saved.body.workbook).validations[0];
  assert.equal(rule.type, "number-range");
  assert.equal(rule.message, "Please enter a number from 0 to 100");

  const rejected = await run.cell("B3", "101");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

  const after = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(sheet1(after.body.workbook).cells.B3, "800");

  for (const value of ["0", "100", "50"]) {
    const accepted = await run.cell("B3", value);
    assert.equal(accepted.status, 200, `expected ${value} to be accepted`);
    assert.equal(sheet1(accepted.body.workbook).cells.B3, value);
  }
  const text = await run.cell("B3", "not a number");
  assert.equal(text.status, 400);
  assert.equal(text.body.error, "Please enter a number from 0 to 100");

  const outside = await run.cell("A2", "any text");
  assert.equal(outside.status, 200, "cells outside the range are unconstrained");
});

test("uses the generic message for another numeric range and enforces it on paste and range move", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const saved = await run.saveValidation({ type: "number-range", range: { start: "D1", end: "E2" }, min: "10", max: "20" });
  const rule = sheet1(saved.body.workbook).validations[0];
  assert.equal(rule.message, "Please enter a number between 10 and 20");

  const pasted = await run.paste("D1", "15\t19");
  assert.equal(pasted.status, 200);
  const refusedPaste = await run.paste("D1", "15\t21");
  assert.equal(refusedPaste.status, 400);
  assert.equal(refusedPaste.body.error, "Please enter a number between 10 and 20");
  assert.equal(sheet1(refusedPaste.body.workbook ?? (await api.api("/api/workbooks/wb-q3-sales")).body.workbook).cells.E1, "19");

  const refusedMove = await run.transfer({
    source: { start: "A1", end: "B1" },
    target: { start: "D2", end: "E2" },
    mode: "copy",
  });
  assert.equal(refusedMove.status, 400);
  assert.equal(refusedMove.body.error, "Please enter a number between 10 and 20");
});

test("a dropdown rule accepts its trimmed values only and keeps existing values", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const saved = await run.saveValidation({
    type: "dropdown",
    range: { start: "A2", end: "A4" },
    values: " East , North ",
  });
  assert.equal(saved.status, 200);
  const rule = sheet1(saved.body.workbook).validations[0];
  assert.deepEqual(rule.values, ["East", "North"]);
  // The values the rule covers are preserved: applying a rule never rewrites a cell.
  assert.equal(sheet1(saved.body.workbook).cells.A2, "East");
  assert.equal(sheet1(saved.body.workbook).cells.A4, "South");

  const rejected = await run.cell("A2", "West");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Please select one of the following values: East, North");
  const kept = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(sheet1(kept.body.workbook).cells.A2, "East");

  const accepted = await run.cell("A4", "North");
  assert.equal(accepted.status, 200);
  assert.equal(sheet1(accepted.body.workbook).cells.A4, "North");

  const cleared = await run.cell("A4", "");
  assert.equal(cleared.status, 200, "clearing a dropdown cell is allowed");

  // A rejected bulk paste keeps every target cell of the rectangle.
  const refusedPaste = await run.paste("A2", "East\t1500\nWest\t800");
  assert.equal(refusedPaste.status, 400);
  assert.equal(refusedPaste.body.error, "Please select one of the following values: East, North");
  const bulk = await api.api("/api/workbooks/wb-q3-sales");
  assert.equal(sheet1(bulk.body.workbook).cells.A2, "East");
  assert.equal(sheet1(bulk.body.workbook).cells.B2, "1200");
  assert.equal(sheet1(bulk.body.workbook).cells.A3, "North");
});

test("keeps a rule active after a refresh, moves it with a row change and deletes it on request", async (t) => {
  const api = await startApi();
  t.after(api.close);
  const run = request(api);

  const saved = await run.saveValidation({
    type: "dropdown",
    range: { start: "A2", end: "A3" },
    values: "East, North",
  });
  const ruleId = sheet1(saved.body.workbook).validations[0].id;

  const restarted = await api.restart();
  t.after(restarted.close);
  const reopened = await restarted.get("/api/workbooks/wb-q3-sales");
  assert.equal(sheet1(reopened.body.workbook).validations.length, 1);

  // An inserted row above the rule moves the constrained cells: they are still constrained.
  await api.api(`/api/workbooks/wb-q3-sales/worksheets/${SHEET1}/rows`, {
    method: "POST",
    body: JSON.stringify({ action: "insert-above", row: 2 }),
  });
  const moved = await run.cell("A4", "West");
  assert.equal(moved.status, 400);
  assert.equal(moved.body.error, "Please select one of the following values: East, North");

  const modification = await run.saveValidation({
    ruleId,
    type: "number-range",
    range: { start: "B2", end: "B3" },
    min: "0",
    max: "1000",
  });
  assert.equal(modification.status, 200);
  const rule = sheet1(modification.body.workbook).validations[0];
  assert.equal(rule.id, ruleId, "a modification keeps the identity of the rule");
  assert.equal(rule.type, "number-range");
  assert.equal(sheet1(modification.body.workbook).validations.length, 1);
  // The modification changes the constraint only; the values stay.
  assert.equal(sheet1(modification.body.workbook).cells.A4, "North");
  assert.equal(sheet1(modification.body.workbook).cells.B4, "800");

  const deleted = await run.deleteValidation(ruleId);
  assert.equal(deleted.status, 200);
  assert.deepEqual(sheet1(deleted.body.workbook).validations, []);
  // Removing the constraint leaves every existing value in place.
  assert.equal(sheet1(deleted.body.workbook).cells.B4, "800");
  const free = await run.cell("B4", "999999");
  assert.equal(free.status, 200);

  const missing = await run.deleteValidation(ruleId);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "Validation rule not found");
});
