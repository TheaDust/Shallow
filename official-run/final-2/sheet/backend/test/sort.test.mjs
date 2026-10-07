import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
  SEED_SECOND_WORKSHEET_ID,
} from "../src/store/workbooks.mjs";

const BASE = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`;
const SECOND_BASE = `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_SECOND_WORKSHEET_ID}`;
const DETAIL = `/api/workbooks/${SEED_WORKBOOK_ID}`;

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-sort-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-sort-dist-"));
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

function worksheetOf(body, worksheetId = SEED_WORKSHEET_ID) {
  return body.workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

const ASC = { range: "A1:C4", column: 2, order: "asc", hasHeaderRow: true };

test("sorting reorders whole records, keeps the header and persists", async () => {
  const app = await startApp();
  try {
    const before = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    const sorted = await send(app.baseUrl, "POST", `${BASE}/sort`, ASC);
    assert.equal(sorted.status, 200);
    const cells = worksheetOf(sorted.body).cells;
    // Header stays; data rows are ordered 700/800/1200 as whole records.
    assert.deepEqual(cells, {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "South",
      B2: "700",
      C2: "Open",
      A3: "North",
      B3: "800",
      C3: "Closed",
      A4: "East",
      B4: "1200",
      C4: "Open",
    });
    // Data outside the range (and the second worksheet) is untouched.
    assert.deepEqual(worksheetOf(sorted.body, SEED_SECOND_WORKSHEET_ID).cells, {});
    assert.notDeepEqual(cells, before.cells);

    await app.restart();
    const reopened = worksheetOf((await json(app.baseUrl, DETAIL)).body);
    assert.equal(reopened.cells.A2, "South");
    assert.equal(reopened.cells.A4, "East");
  } finally {
    await app.stop();
  }
});

test("descending order and text comparison sort by the chosen column", async () => {
  const app = await startApp();
  try {
    const sorted = await send(app.baseUrl, "POST", `${BASE}/sort`, {
      range: "A1:C4",
      column: 1,
      order: "desc",
      hasHeaderRow: true,
    });
    assert.equal(sorted.status, 200);
    const cells = worksheetOf(sorted.body).cells;
    // Text descending: South > North > East, records move together.
    assert.equal(cells.A2, "South");
    assert.equal(cells.B2, "700");
    assert.equal(cells.A3, "North");
    assert.equal(cells.B3, "800");
    assert.equal(cells.A4, "East");
    assert.equal(cells.B4, "1200");
    assert.equal(cells.A1, "Region");
  } finally {
    await app.stop();
  }
});

test("without a header row the first row participates in the sort", async () => {
  const app = await startApp();
  try {
    const sorted = await send(app.baseUrl, "POST", `${BASE}/sort`, {
      range: "A1:C4",
      column: 1,
      order: "asc",
      hasHeaderRow: false,
    });
    assert.equal(sorted.status, 200);
    const cells = worksheetOf(sorted.body).cells;
    assert.equal(cells.A1, "East");
    assert.equal(cells.A2, "North");
    assert.equal(cells.A3, "Region");
    assert.equal(cells.A4, "South");
  } finally {
    await app.stop();
  }
});

test("numbers compare by value and equal keys keep their original order", async () => {
  const app = await startApp();
  try {
    // B column: 10, 2, 2 -> numeric order is 2, 2, 10; the two 2s keep their
    // original relative order (North before South).
    await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "B2", value: "10" });
    await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "B3", value: "2" });
    await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "B4", value: "2" });
    const sorted = await send(app.baseUrl, "POST", `${BASE}/sort`, ASC);
    assert.equal(sorted.status, 200);
    const cells = worksheetOf(sorted.body).cells;
    assert.equal(cells.B2, "2");
    assert.equal(cells.B3, "2");
    assert.equal(cells.B4, "10");
    assert.equal(cells.A2, "North");
    assert.equal(cells.A3, "South");
    assert.equal(cells.A4, "East");
  } finally {
    await app.stop();
  }
});

test("parseable dates compare chronologically rather than as text", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "A2", value: "2026-12-01" });
    await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "A3", value: "2026-01-15" });
    await send(app.baseUrl, "PATCH", `${BASE}/cells`, { coordinate: "A4", value: "2026-06-30" });
    const sorted = await send(app.baseUrl, "POST", `${BASE}/sort`, {
      range: "A1:C4",
      column: 1,
      order: "asc",
      hasHeaderRow: true,
    });
    assert.equal(sorted.status, 200);
    const cells = worksheetOf(sorted.body).cells;
    assert.equal(cells.A2, "2026-01-15");
    assert.equal(cells.A3, "2026-06-30");
    assert.equal(cells.A4, "2026-12-01");
  } finally {
    await app.stop();
  }
});

test("a moved formula's relative row references follow its record", async () => {
  const app = await startApp();
  try {
    // Sheet2 gets a table with a computed column.
    for (const [coordinate, value] of [
      ["A1", "Region"],
      ["B1", "Sales"],
      ["C1", "Double"],
      ["A2", "East"],
      ["B2", "100"],
      ["C2", "=B2*2"],
      ["A3", "North"],
      ["B3", "300"],
      ["C3", "=B3*2"],
      ["A4", "South"],
      ["B4", "200"],
      ["C4", "=B4*2"],
    ]) {
      await send(app.baseUrl, "PATCH", `${SECOND_BASE}/cells`, { coordinate, value });
    }
    const sorted = await send(app.baseUrl, "POST", `${SECOND_BASE}/sort`, ASC);
    assert.equal(sorted.status, 200);
    const cells = worksheetOf(sorted.body, SEED_SECOND_WORKSHEET_ID).cells;
    assert.equal(cells.A2, "East");
    assert.equal(cells.C2, "=B2*2");
    assert.equal(cells.A3, "South");
    assert.equal(cells.C3, "=B3*2");
    assert.equal(cells.A4, "North");
    assert.equal(cells.C4, "=B4*2");
  } finally {
    await app.stop();
  }
});

test("blank sort keys stay at the bottom in both directions", async () => {
  const app = await startApp();
  try {
    const ascending = await send(app.baseUrl, "POST", `${BASE}/sort`, {
      range: "A1:C6",
      column: 2,
      order: "asc",
      hasHeaderRow: true,
    });
    assert.equal(ascending.status, 200);
    const asc = worksheetOf(ascending.body).cells;
    assert.equal(asc.A2, "South");
    assert.equal(asc.A3, "North");
    assert.equal(asc.A4, "East");
    assert.equal(asc.A5, undefined);
    assert.equal(asc.A6, undefined);

    const descending = await send(app.baseUrl, "POST", `${BASE}/sort`, {
      range: "A1:C6",
      column: 2,
      order: "desc",
      hasHeaderRow: true,
    });
    const desc = worksheetOf(descending.body).cells;
    assert.equal(desc.A2, "East");
    assert.equal(desc.A3, "North");
    assert.equal(desc.A4, "South");
    assert.equal(desc.A5, undefined);
    assert.equal(desc.A6, undefined);
  } finally {
    await app.stop();
  }
});

test("malformed sort requests are rejected and the grid keeps its order", async () => {
  const app = await startApp();
  try {
    const before = worksheetOf((await json(app.baseUrl, DETAIL)).body).cells;
    for (const payload of [
      { range: "nope", column: 2, order: "asc", hasHeaderRow: true },
      { range: "A1:C4", column: 9, order: "asc", hasHeaderRow: true },
      { range: "A1:C4", column: 2, order: "up", hasHeaderRow: true },
      { range: "A1:C4", column: 2, order: "asc", hasHeaderRow: "yes" },
    ]) {
      const response = await send(app.baseUrl, "POST", `${BASE}/sort`, payload);
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.equal(response.body.error, "Invalid sort request");
    }
    assert.deepEqual(worksheetOf((await json(app.baseUrl, DETAIL)).body).cells, before);
  } finally {
    await app.stop();
  }
});

test("sorting one worksheet never touches another worksheet", async () => {
  const app = await startApp();
  try {
    const sorted = await send(app.baseUrl, "POST", `${BASE}/sort`, ASC);
    assert.equal(sorted.status, 200);
    const second = worksheetOf(sorted.body, SEED_SECOND_WORKSHEET_ID);
    assert.deepEqual(second.cells, {});
  } finally {
    await app.stop();
  }
});
