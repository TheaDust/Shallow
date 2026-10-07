import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_CASE_SENSITIVE_ID,
  EVO_CASE_SENSITIVE_WORKSHEET_ID,
  EVO_FIND_NEXT_ID,
  EVO_FIND_NEXT_WORKSHEET_ID,
  EVO_FREEZE_BOTH_ID,
  EVO_FREEZE_BOTH_WORKSHEET_ID,
  EVO_FREEZE_COLUMN_ID,
  EVO_FREEZE_ROW_ID,
  EVO_FREEZE_ROW_WORKSHEET_ID,
  EVO_REPLACE_ALL_ID,
  EVO_REPLACE_ALL_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-freeze-"));
  if (prepare) await prepare(dataDir);
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return { baseUrl: `http://127.0.0.1:${restarted.address().port}`, stop: () => new Promise((d) => restarted.close(d)) };
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

function patch(body) {
  return { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const getWorkbook = async (baseUrl, id) => (await json(baseUrl, `/api/workbooks/${id}`)).body.workbook;

/** The seeded lane code of one `ScrollLedger` row (column A). */
const ledgerCellFor = (row, column) => (column === 1 ? `SL-${1000 + row}` : null);

const freezeUrl = (workbookId, worksheetId) =>
  `/api/workbooks/${workbookId}/worksheets/${worksheetId}/freeze`;

const replaceUrl = (workbookId, worksheetId) =>
  `/api/workbooks/${workbookId}/worksheets/${worksheetId}/replace`;

test("pre-provisions the independent EVO freeze and find workbooks next to the seed", async () => {
  const app = await startApp();
  const list = await json(app.baseUrl, "/api/workbooks");
  const names = list.body.workbooks.map((entry) => entry.name);
  for (const expected of [
    "EVO-N01-FREEZE-ROW",
    "EVO-N01-FREEZE-COLUMN",
    "EVO-N01-FREEZE-BOTH",
    "EVO-N02-FIND-NEXT",
    "EVO-N02-REPLACE-ALL",
    "EVO-N02-CASE-SENSITIVE",
  ]) {
    assert.ok(names.includes(expected), `${expected} is seeded`);
  }
  // The older EVO stamps keep the shared seed workbook first on the home page.
  assert.equal(names[0], "Q3 Sales");

  const ledger = await getWorkbook(app.baseUrl, EVO_FREEZE_ROW_ID);
  assert.equal(ledger.activeWorksheetId, EVO_FREEZE_ROW_WORKSHEET_ID);
  assert.equal(ledger.worksheets.length, 1);
  assert.equal(ledger.worksheets[0].name, "ScrollLedger");
  assert.equal(ledger.worksheets[0].cells.A1, "Lane");
  assert.equal(ledger.worksheets[0].cells.L1, "Note");
  assert.equal(ledger.worksheets[0].cells.A40, ledgerCellFor(40, 1));
  assert.ok(ledger.worksheets[0].cells.L40);

  const wide = await getWorkbook(app.baseUrl, EVO_FREEZE_COLUMN_ID);
  assert.equal(wide.worksheets[0].name, "ScrollLedger");
  assert.ok(wide.worksheets[0].cells.L1);
  const both = await getWorkbook(app.baseUrl, EVO_FREEZE_BOTH_ID);
  assert.ok(both.worksheets[0].cells.L40);
  assert.equal(both.worksheets[0].freeze, undefined);

  const next = await getWorkbook(app.baseUrl, EVO_FIND_NEXT_ID);
  assert.equal(next.worksheets[0].name, "Narrative");
  assert.deepEqual(next.worksheets[0].cells, { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" });
  const replaceAll = await getWorkbook(app.baseUrl, EVO_REPLACE_ALL_ID);
  assert.deepEqual(replaceAll.worksheets[0].cells, {
    F3: "Cobalt",
    F6: "Cobalt",
    F9: "Cobalt",
    F12: "Copper",
  });
  const caseSensitive = await getWorkbook(app.baseUrl, EVO_CASE_SENSITIVE_ID);
  assert.deepEqual(caseSensitive.worksheets[0].cells, { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" });
  await app.stop();
});

test("a frozen pane state is stored per worksheet and survives a restart", async () => {
  const app = await startApp();

  const frozen = await json(
    app.baseUrl,
    freezeUrl(EVO_FREEZE_ROW_ID, EVO_FREEZE_ROW_WORKSHEET_ID),
    patch({ rows: 1, columns: 0 }),
  );
  assert.equal(frozen.status, 200);
  assert.deepEqual(frozen.body.workbook.worksheets[0].freeze, { rows: 1, columns: 0 });

  const both = await json(
    app.baseUrl,
    freezeUrl(EVO_FREEZE_BOTH_ID, EVO_FREEZE_BOTH_WORKSHEET_ID),
    patch({ rows: 3, columns: 2 }),
  );
  assert.equal(both.status, 200);
  assert.deepEqual(both.body.workbook.worksheets[0].freeze, { rows: 3, columns: 2 });

  // A state the editor cannot express is rejected and nothing is stored.
  for (const invalid of [{ rows: -1, columns: 0 }, { rows: 0, columns: 1.5 }, { rows: "2", columns: 0 }, {}]) {
    const rejected = await json(
      app.baseUrl,
      freezeUrl(EVO_FREEZE_ROW_ID, EVO_FREEZE_ROW_WORKSHEET_ID),
      patch(invalid),
    );
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Invalid frozen pane state");
  }

  const restarted = await app.restart();
  const ledger = await getWorkbook(restarted.baseUrl, EVO_FREEZE_ROW_ID);
  assert.deepEqual(ledger.worksheets[0].freeze, { rows: 1, columns: 0 });
  const bothAfter = await getWorkbook(restarted.baseUrl, EVO_FREEZE_BOTH_ID);
  assert.deepEqual(bothAfter.worksheets[0].freeze, { rows: 3, columns: 2 });
  // The column scenario keeps its own panes untouched.
  const column = await getWorkbook(restarted.baseUrl, EVO_FREEZE_COLUMN_ID);
  assert.equal(column.worksheets[0].freeze, undefined);

  // Unfreezing removes the stored state again.
  const cleared = await json(
    restarted.baseUrl,
    freezeUrl(EVO_FREEZE_ROW_ID, EVO_FREEZE_ROW_WORKSHEET_ID),
    patch({ rows: 0, columns: 0 }),
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.workbook.worksheets[0].freeze, undefined);
  await restarted.stop();
});

test("a worksheet without frozen panes stays unfrozen while another sheet freezes", async () => {
  const app = await startApp();
  const frozen = await json(
    app.baseUrl,
    `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/freeze`,
    patch({ rows: 2, columns: 1 }),
  );
  assert.equal(frozen.status, 200);
  assert.deepEqual(frozen.body.workbook.worksheets[0].freeze, { rows: 2, columns: 1 });
  assert.equal(frozen.body.workbook.worksheets[1].freeze, undefined);
  await app.stop();
});

test("a replacement writes every listed cell and persists after a restart", async () => {
  const app = await startApp();
  const result = await json(
    app.baseUrl,
    replaceUrl(EVO_REPLACE_ALL_ID, EVO_REPLACE_ALL_WORKSHEET_ID),
    send({
      updates: [
        { coordinate: "F3", value: "Indigo" },
        { coordinate: "F6", value: "Indigo" },
        { coordinate: "F9", value: "Indigo" },
      ],
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.replaced, 3);
  assert.deepEqual(result.body.workbook.worksheets[0].cells, {
    F3: "Indigo",
    F6: "Indigo",
    F9: "Indigo",
    F12: "Copper",
  });

  const restarted = await app.restart();
  const workbook = await getWorkbook(restarted.baseUrl, EVO_REPLACE_ALL_ID);
  assert.equal(workbook.worksheets[0].cells.F6, "Indigo");
  // The untouched scenario workbooks keep their own text.
  const caseSensitive = await getWorkbook(restarted.baseUrl, EVO_CASE_SENSITIVE_ID);
  assert.deepEqual(caseSensitive.worksheets[0].cells, { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" });
  await restarted.stop();
});

test("a rejected replacement changes no cell of the worksheet", async () => {
  const app = await startApp(async (dataDir) => {
    const state = createSeedState();
    const worksheet = state.workbooks.find((workbook) => workbook.id === EVO_REPLACE_ALL_ID).worksheets[0];
    worksheet.validationRules = [{ range: "F9", type: "dropdown", values: ["Copper", "Cobalt"] }];
    await writeFile(join(dataDir, "workbooks.json"), JSON.stringify(state, null, 2));
  });

  const rejected = await json(
    app.baseUrl,
    replaceUrl(EVO_REPLACE_ALL_ID, EVO_REPLACE_ALL_WORKSHEET_ID),
    send({
      updates: [
        { coordinate: "F3", value: "Indigo" },
        { coordinate: "F9", value: "Indigo" },
      ],
    }),
  );
  assert.equal(rejected.status, 400);

  const malformed = await json(
    app.baseUrl,
    replaceUrl(EVO_REPLACE_ALL_ID, EVO_REPLACE_ALL_WORKSHEET_ID),
    send({ updates: [{ coordinate: "nope", value: "Indigo" }] }),
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, "Invalid replace request");
  const empty = await json(app.baseUrl, replaceUrl(EVO_REPLACE_ALL_ID, EVO_REPLACE_ALL_WORKSHEET_ID), send({ updates: [] }));
  assert.equal(empty.status, 400);

  const after = await getWorkbook(app.baseUrl, EVO_REPLACE_ALL_ID);
  assert.deepEqual(after.worksheets[0].cells, {
    F3: "Cobalt",
    F6: "Cobalt",
    F9: "Cobalt",
    F12: "Copper",
  });
  await app.stop();
});
