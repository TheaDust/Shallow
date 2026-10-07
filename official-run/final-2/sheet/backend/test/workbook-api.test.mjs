import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_ARCHIVE_RESERVED_ID,
  EVO_RENAME_DUP_ID,
  EVO_RENAME_LIMIT_ID,
  EVO_RENAME_LIMIT_WORKSHEET_ID,
  EVO_RENAME_OK_ID,
  EVO_RENAME_OK_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
} from "../src/store/workbooks.mjs";

async function startApp({ withFrontend = false } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-data-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  await writeFile(join(staticRoot, "assets", "app.js"), "export const value = 1;\n", "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    dataDir,
    staticRoot,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    restart() {
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
      return new Promise((done) => restarted.listen(0, "127.0.0.1", () => {
        done({ server: restarted, baseUrl: `http://127.0.0.1:${restarted.address().port}` });
      }));
    },
    withFrontend,
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

test("seeds the Q3 Sales workbook with worksheet Sheet1 and cell A1 = Region", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    assert.equal(list.body.workbooks[0].name, "Q3 Sales");
    assert.equal(list.body.workbooks[0].id, SEED_WORKBOOK_ID);
    assert.ok(list.body.workbooks[0].updatedAt);

    const detail = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.workbook.name, "Q3 Sales");
    assert.equal(detail.body.workbook.activeWorksheetId, SEED_WORKSHEET_ID);
    assert.equal(detail.body.workbook.worksheets.length, 2);
    assert.equal(detail.body.workbook.worksheets[0].name, "Sheet1");
    assert.equal(detail.body.workbook.worksheets[0].cells.A1, "Region");
    assert.equal(detail.body.workbook.worksheets[1].name, "Sheet2");
  } finally {
    await app.stop();
  }
});

test("creates a blank workbook with only Sheet1 and persists it across restarts", async () => {
  const app = await startApp();
  try {
    const before = await json(app.baseUrl, "/api/workbooks");
    const created = await json(app.baseUrl, "/api/workbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(created.status, 201);
    const workbook = created.body.workbook;
    assert.equal(workbook.worksheets.length, 1);
    assert.equal(workbook.worksheets[0].name, "Sheet1");
    assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
    assert.deepEqual(workbook.worksheets[0].cells, {});

    const restarted = await app.restart();
    try {
      const list = await json(restarted.baseUrl, "/api/workbooks");
      assert.equal(list.body.workbooks.length, before.body.workbooks.length + 1);
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${workbook.id}`);
      assert.equal(persisted.body.workbook.name, "Untitled workbook");
      assert.equal(persisted.body.workbook.worksheets[0].name, "Sheet1");
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("renames a workbook, trims spaces and keeps the seed on rejection", async () => {
  const app = await startApp();
  try {
    const renamed = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Q3 Sales Revised  " }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "Q3 Sales Revised");

    const rejected = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name cannot be empty");

    const after = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(after.body.workbook.name, "Q3 Sales Revised");
    assert.equal(after.body.workbook.worksheets[0].cells.A1, "Region");
  } finally {
    await app.stop();
  }
});

test("pre-provisions the independent EVO-M01 rename workbooks next to the seed", async () => {
  const app = await startApp();
  try {
    const list = await json(app.baseUrl, "/api/workbooks");
    const names = list.body.workbooks.map((entry) => entry.name);
    assert.ok(names.includes("EVO-M01-RENAME-OK"));
    assert.ok(names.includes("EVO-M01-RENAME-DUP"));
    assert.ok(names.includes("EVO-M01-ARCHIVE-RESERVED"));
    assert.ok(names.includes("EVO-M01-RENAME-LIMIT"));

    const ok = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_OK_ID}`);
    assert.equal(ok.body.workbook.name, "EVO-M01-RENAME-OK");
    assert.equal(ok.body.workbook.activeWorksheetId, EVO_RENAME_OK_WORKSHEET_ID);
    assert.equal(ok.body.workbook.worksheets[0].name, "IdentityLog");
    assert.equal(ok.body.workbook.worksheets[0].cells.F3, "unreviewed");

    const dup = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_DUP_ID}`);
    assert.equal(dup.body.workbook.worksheets[0].name, "IdentityLog");

    const archive = await json(app.baseUrl, `/api/workbooks/${EVO_ARCHIVE_RESERVED_ID}`);
    assert.equal(archive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");

    const limit = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_LIMIT_ID}`);
    assert.equal(limit.body.workbook.activeWorksheetId, EVO_RENAME_LIMIT_WORKSHEET_ID);
    assert.equal(limit.body.workbook.worksheets[0].name, "LimitProbe");
    assert.equal(limit.body.workbook.worksheets[0].cells.C2, "limit sentinel");
  } finally {
    await app.stop();
  }
});

test("renames an EVO workbook after trimming and keeps the other cells across a restart", async () => {
  const app = await startApp();
  try {
    const renamed = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_OK_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  FY26 Procurement Ledger  " }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.workbook.name, "FY26 Procurement Ledger");
    assert.equal(renamed.body.workbook.id, EVO_RENAME_OK_ID);

    const restarted = await app.restart();
    try {
      const reopened = await json(restarted.baseUrl, `/api/workbooks/${EVO_RENAME_OK_ID}`);
      assert.equal(reopened.body.workbook.name, "FY26 Procurement Ledger");
      assert.equal(reopened.body.workbook.worksheets[0].cells.F3, "unreviewed");
      const list = await json(restarted.baseUrl, "/api/workbooks");
      assert.ok(list.body.workbooks.some((entry) => entry.name === "FY26 Procurement Ledger"));
      assert.ok(!list.body.workbooks.some((entry) => entry.name === "EVO-M01-RENAME-OK"));
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("rejects a case-insensitive duplicate workbook name and keeps both workbooks", async () => {
  const app = await startApp();
  try {
    const rejected = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_DUP_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "evo-m01-archive-reserved" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name already exists");

    const after = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_DUP_ID}`);
    assert.equal(after.body.workbook.name, "EVO-M01-RENAME-DUP");
    const archive = await json(app.baseUrl, `/api/workbooks/${EVO_ARCHIVE_RESERVED_ID}`);
    assert.equal(archive.body.workbook.name, "EVO-M01-ARCHIVE-RESERVED");

    // A name that only repeats the workbook's own name is not a duplicate.
    const own = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_DUP_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  evo-M01-rename-dup  " }),
    });
    assert.equal(own.status, 200);
    assert.equal(own.body.workbook.name, "evo-M01-rename-dup");
  } finally {
    await app.stop();
  }
});

test("rejects a workbook name longer than 80 characters and accepts the 80-character limit", async () => {
  const app = await startApp();
  try {
    const tooLong = `EVO-${'A'.repeat(77)}`;
    assert.equal(tooLong.length, 81);
    const rejected = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_LIMIT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `  ${tooLong}  ` }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Workbook name must be 80 characters or fewer");

    const after = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_LIMIT_ID}`);
    assert.equal(after.body.workbook.name, "EVO-M01-RENAME-LIMIT");
    assert.equal(after.body.workbook.worksheets[0].cells.C2, "limit sentinel");

    const atLimit = "L".repeat(80);
    const accepted = await json(app.baseUrl, `/api/workbooks/${EVO_RENAME_LIMIT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: atLimit }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.workbook.name, atLimit);

    const restarted = await app.restart();
    try {
      const reopened = await json(restarted.baseUrl, `/api/workbooks/${EVO_RENAME_LIMIT_ID}`);
      assert.equal(reopened.body.workbook.name, atLimit);
      assert.equal(reopened.body.workbook.worksheets[0].cells.C2, "limit sentinel");
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }
  } finally {
    await app.stop();
  }
});

test("creates a blank workbook from the creation page even without a typed name", async () => {
  const app = await startApp();
  try {
    const created = await json(app.baseUrl, "/api/workbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(created.status, 201);
    const workbook = created.body.workbook;
    assert.equal(workbook.name, "Untitled workbook");
    assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Sheet1"]);
    assert.equal(workbook.activeWorksheetId, workbook.worksheets[0].id);
    assert.deepEqual(workbook.worksheets[0].cells, {});

    const trimmed = await json(app.baseUrl, "/api/workbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(trimmed.status, 201);
    assert.equal(trimmed.body.workbook.name, "Untitled workbook");

    const named = await json(app.baseUrl, "/api/workbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Budget 2026  " }),
    });
    assert.equal(named.status, 201);
    assert.equal(named.body.workbook.name, "Budget 2026");
  } finally {
    await app.stop();
  }
});

test("writes and clears a single cell, persisting it across restarts", async () => {
  const app = await startApp();
  try {
    const saved = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "d2", value: "=1+2" }),
      },
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.workbook.worksheets[0].cells.D2, "=1+2");
    assert.equal(saved.body.workbook.worksheets[0].cells.A1, "Region");

    const restarted = await app.restart();
    try {
      const persisted = await json(restarted.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
      assert.equal(persisted.body.workbook.worksheets[0].cells.D2, "=1+2");
    } finally {
      await new Promise((done) => restarted.server.close(done));
    }

    const cleared = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "D2", value: "" }),
      },
    );
    assert.equal(cleared.status, 200);
    assert.equal("D2" in cleared.body.workbook.worksheets[0].cells, false);
    assert.equal(cleared.body.workbook.worksheets[0].cells.A1, "Region");
  } finally {
    await app.stop();
  }
});

test("rejects a malformed cell write without touching the stored state", async () => {
  const app = await startApp();
  try {
    const badCoordinate = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "1A", value: "x" }),
      },
    );
    assert.equal(badCoordinate.status, 400);
    assert.equal(badCoordinate.body.error, "Unknown cell reference");

    const badValue = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "A2", value: 12 }),
      },
    );
    assert.equal(badValue.status, 400);

    const unknownSheet = await json(
      app.baseUrl,
      `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/missing/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "A2", value: "x" }),
      },
    );
    assert.equal(unknownSheet.status, 400);

    const unknownWorkbook = await json(
      app.baseUrl,
      `/api/workbooks/missing/worksheets/${SEED_WORKSHEET_ID}/cells`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coordinate: "A2", value: "x" }),
      },
    );
    assert.equal(unknownWorkbook.status, 404);

    const after = await json(app.baseUrl, `/api/workbooks/${SEED_WORKBOOK_ID}`);
    assert.equal(after.body.workbook.worksheets[0].cells.A2, "East");
  } finally {
    await app.stop();
  }
});

test("reports unknown workbooks and unknown api routes without failing the process", async () => {
  const app = await startApp();
  try {
    assert.equal((await json(app.baseUrl, "/api/workbooks/missing")).status, 404);
    assert.equal((await json(app.baseUrl, "/api/nope")).status, 404);
    assert.equal((await json(app.baseUrl, "/api/workbooks/missing", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  } finally {
    await app.stop();
  }
});

test("serves the frontend entry for / and 404 for unknown static paths", async () => {
  const app = await startApp({ withFrontend: true });
  try {
    const index = await fetch(`${app.baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /id="root"/);

    const asset = await fetch(`${app.baseUrl}/assets/app.js`);
    assert.equal(asset.status, 200);

    const missing = await fetch(`${app.baseUrl}/favicon.ico`);
    assert.equal(missing.status, 404);

    const health = await json(app.baseUrl, "/health");
    assert.deepEqual(health.body, { ok: true });
    const apiHealth = await json(app.baseUrl, "/api/health");
    assert.deepEqual(apiHealth.body, { ok: true });
  } finally {
    await app.stop();
  }
});
