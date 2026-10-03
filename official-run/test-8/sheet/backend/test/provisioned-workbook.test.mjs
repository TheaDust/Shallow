import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

/**
 * A workbook planted into storage by hand (for example the evaluation seed of
 * the formula requirements, which only lists cells) must open like any other
 * workbook: the grid size, selection and rule list are filled in, cell values
 * are served as raw text, and formula expressions are never resolved or lost
 * on the server — the browser derives their results from the same map.
 */

const WORKBOOK_ID = "workbook-q3-sales";
const SHEET_1 = "workbook-q3-sales-sheet-1";

const SEEDED_FORMULAS = { A1: 2, B1: 3, C1: "=A1+B1", D1: "=C1*2" };

/** Starts the app over a temporary store holding exactly `state`. */
async function startApp(state) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-provisioned-"));
  await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const { handler } = createApp({ dataDir });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    dataDir,
    async call(path, init) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      return { status: response.status, body };
    },
    async worksheet() {
      const detail = await this.call(`/api/workbooks/${WORKBOOK_ID}`);
      return detail.body.workbook.worksheets.find((entry) => entry.id === SHEET_1);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function plantedState() {
  return {
    workbooks: [
      {
        id: WORKBOOK_ID,
        name: "Q3 Sales",
        worksheets: [{ id: SHEET_1, name: "Sheet1", cells: { ...SEEDED_FORMULAS } }],
      },
    ],
  };
}

test("serves a hand-written seed whose worksheet only lists cells", async (t) => {
  const app = await startApp(plantedState());
  t.after(() => app.close());

  const worksheet = await app.worksheet();
  assert.deepEqual(worksheet.cells, { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
  assert.equal(worksheet.rowCount, 50);
  assert.equal(worksheet.columnCount, 26);
  assert.deepEqual(worksheet.selection, { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
  assert.deepEqual(worksheet.validations, []);

  const detail = await app.call(`/api/workbooks/${WORKBOOK_ID}`);
  assert.equal(detail.body.workbook.activeWorksheetId, SHEET_1);
  assert.equal(detail.body.workbook.name, "Q3 Sales");
});

test("grows the grid of a planted seed to cover its cells", async (t) => {
  const state = plantedState();
  state.workbooks[0].worksheets[0].rowCount = 2;
  state.workbooks[0].worksheets[0].columnCount = 1;
  state.workbooks[0].worksheets[0].cells.AA60 = "=A1+B1";
  const app = await startApp(state);
  t.after(() => app.close());

  const worksheet = await app.worksheet();
  assert.equal(worksheet.rowCount, 60);
  assert.equal(worksheet.columnCount, 27);
  assert.equal(worksheet.cells.AA60, "=A1+B1");
});

test("honours a stored grid size smaller than the default", async (t) => {
  const state = plantedState();
  state.workbooks[0].worksheets[0].rowCount = 3;
  state.workbooks[0].worksheets[0].columnCount = 5;
  const app = await startApp(state);
  t.after(() => app.close());

  const worksheet = await app.worksheet();
  assert.equal(worksheet.rowCount, 3);
  assert.equal(worksheet.columnCount, 5);
});

test("keeps the planted formulas when a later value edit is persisted and re-read", async (t) => {
  const app = await startApp(plantedState());
  t.after(() => app.close());

  const written = await app.call(`/api/workbooks/${WORKBOOK_ID}/worksheets/${SHEET_1}/cells`, {
    method: "POST",
    body: JSON.stringify({ start: { row: 0, col: 0 }, values: [["2"], ["7"]] }),
  });
  assert.equal(written.status, 200);

  const worksheet = await app.worksheet();
  // The edit replaced A1 and wrote A2; the planted formulas keep their text.
  assert.deepEqual(worksheet.cells, {
    A1: "2",
    B1: "3",
    C1: "=A1+B1",
    D1: "=C1*2",
    A2: "7",
  });
});

test("serves a workbook that carries no worksheet at all", async (t) => {
  const app = await startApp({ workbooks: [{ id: WORKBOOK_ID, name: "Q3 Sales" }] });
  t.after(() => app.close());

  const detail = await app.call(`/api/workbooks/${WORKBOOK_ID}`);
  const [worksheet] = detail.body.workbook.worksheets;
  assert.equal(detail.body.workbook.activeWorksheetId, worksheet.id);
  assert.deepEqual(worksheet.cells, {});
  assert.equal(worksheet.rowCount, 50);
  assert.equal(worksheet.name, "Sheet1");
});
