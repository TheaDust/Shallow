import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const serverEntry = join(here, "../src/server.mjs");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function requestJson(baseUrl, path, { method = "GET", body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function startServer() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-server-"));
  const port = await getFreePort();
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      ARC_EXTRA_PORTS: "0",
      SHALLOW_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, dataDir, baseUrl };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGTERM");
  throw new Error("server did not become ready");
}

async function stopServer(child, dataDir) {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(dataDir, { recursive: true, force: true });
}

test("exports the active worksheet as a CSV download", async () => {
  const { child, dataDir, baseUrl } = await startServer();
  try {
    const list = await requestJson(baseUrl, "/api/workbooks");
    const { workbooks } = await list.json();
    const id = workbooks[0].id;
    const detail = await requestJson(baseUrl, `/api/workbooks/${id}`);
    const before = await detail.json();

    const exported = await requestJson(baseUrl, `/api/workbooks/${id}/export-csv`);
    assert.equal(exported.status, 200);
    const contentType = exported.headers.get("content-type") ?? "";
    assert.ok(contentType.includes("text/csv"));
    const disposition = exported.headers.get("content-disposition") ?? "";
    assert.ok(disposition.includes("attachment"));
    assert.ok(disposition.includes(".csv"));
    const body = await exported.text();
    assert.equal(
      body,
      "Region,Sales,Status\r\nEast,1200,Open\r\nNorth,800,Closed\r\nSouth,700,Open\r\n",
    );

    const afterDetail = await requestJson(baseUrl, `/api/workbooks/${id}`);
    const after = await afterDetail.json();
    assert.equal(after.updatedAt, before.updatedAt);
    assert.deepEqual(after.sheets[0].cells, before.sheets[0].cells);

    const missing = await requestJson(baseUrl, "/api/workbooks/wb_missing/export-csv");
    assert.equal(missing.status, 404);
  } finally {
    await stopServer(child, dataDir);
  }
});

test("serves health, workbook CRUD, and import over HTTP", async () => {
  const { child, dataDir, baseUrl } = await startServer();
  try {
    const health = await requestJson(baseUrl, "/health");
    assert.equal(health.status, 200);
    const apiHealth = await requestJson(baseUrl, "/api/health");
    assert.equal(apiHealth.status, 200);

    const list = await requestJson(baseUrl, "/api/workbooks");
    assert.equal(list.status, 200);
    const { workbooks } = await list.json();
    assert.equal(workbooks.length, 1);
    assert.equal(workbooks[0].name, "Q3 Sales");
    const id = workbooks[0].id;

    const detail = await requestJson(baseUrl, `/api/workbooks/${id}`);
    const workbook = await detail.json();
    assert.equal(workbook.sheets[0].cells.A1, "Region");

    const renamed = await requestJson(baseUrl, `/api/workbooks/${id}`, {
      method: "PATCH",
      body: { name: "Q3 Sales Revised" },
    });
    assert.equal((await renamed.json()).name, "Q3 Sales Revised");

    const created = await requestJson(baseUrl, "/api/workbooks", {
      method: "POST",
      body: { name: "Budget" },
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).name, "Budget");

    const imported = await requestJson(baseUrl, "/api/import-csv", {
      method: "POST",
      body: { fileName: "quarterly.csv", content: "Region,Amount\nEast,1200\nNorth,800\n" },
    });
    assert.equal(imported.status, 201);
    const importedWorkbook = await imported.json();
    assert.equal(importedWorkbook.name, "quarterly");
    assert.equal(importedWorkbook.sheets[0].cells.B3, "800");

    const invalid = await requestJson(baseUrl, "/api/import-csv", {
      method: "POST",
      body: { fileName: "bad.csv", content: 'a,"unclosed\n' },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "Invalid CSV file format. Import failed.");

    const finalList = await requestJson(baseUrl, "/api/workbooks");
    const names = (await finalList.json()).workbooks.map((entry) => entry.name);
    assert.ok(names.includes("Q3 Sales Revised"));
    assert.ok(names.includes("Budget"));
    assert.ok(names.includes("quarterly"));
    assert.ok(!names.includes("bad"));

    const missing = await requestJson(baseUrl, "/api/workbooks/wb_missing");
    assert.equal(missing.status, 404);
    const unknownApi = await requestJson(baseUrl, "/api/nope");
    assert.equal(unknownApi.status, 404);
    const root = await requestJson(baseUrl, "/");
    assert.ok(root.status === 200 || root.status === 404);
  } finally {
    await stopServer(child, dataDir);
  }
});

test("copy/paste, cut, undo and redo work over HTTP and persist", async () => {
  const { child, dataDir, baseUrl } = await startServer();
  try {
    const list = await requestJson(baseUrl, "/api/workbooks");
    const { workbooks } = await list.json();
    const id = workbooks[0].id;
    const workbook = (await (await requestJson(baseUrl, `/api/workbooks/${id}`)).json());
    const sheetId = workbook.activeSheetId;

    await requestJson(baseUrl, `/api/workbooks/${id}/cells`, {
      method: "PATCH",
      body: { sheetId, updates: { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" } },
    });

    const captured = await requestJson(baseUrl, `/api/workbooks/${id}/clipboard`, {
      method: "POST",
      body: { sheetId, kind: "copy", range: { start: "A1", end: "B2" } },
    });
    assert.equal((await captured.json()).clipboard.kind, "copy");

    const pasted = await requestJson(baseUrl, `/api/workbooks/${id}/paste`, {
      method: "POST",
      body: { sheetId, target: "D1" },
    });
    const pastedBody = await pasted.json();
    assert.equal(pastedBody.sheets[0].cells.D1, "Item");
    assert.equal(pastedBody.sheets[0].cells.E2, "4");
    assert.equal(pastedBody.sheets[0].cells.A1, "Item"); // copy keeps the source

    // undo the paste over HTTP and confirm the undone state persists
    const undone = await requestJson(baseUrl, `/api/workbooks/${id}/undo`, { method: "POST" });
    const undoneBody = await undone.json();
    assert.ok(!("D1" in undoneBody.sheets[0].cells)); // D1 is empty in the seed
    assert.equal(undoneBody.redoAvailable, true);
    const reloaded = await requestJson(baseUrl, `/api/workbooks/${id}`);
    assert.ok(!("D1" in (await reloaded.json()).sheets[0].cells));

    // redo restores the paste; a fresh workbook starts with no history
    const redone = await requestJson(baseUrl, `/api/workbooks/${id}/redo`, { method: "POST" });
    assert.equal((await redone.json()).sheets[0].cells.D1, "Item");
    const created = await requestJson(baseUrl, "/api/workbooks", {
      method: "POST",
      body: { name: "Fresh" },
    });
    const fresh = await created.json();
    const noUndo = await requestJson(baseUrl, `/api/workbooks/${fresh.id}/undo`, { method: "POST" });
    assert.equal(noUndo.status, 400);
    assert.equal((await noUndo.json()).error, "Nothing to undo");

    // cut clears the source only after the paste lands
    await requestJson(baseUrl, `/api/workbooks/${id}/clipboard`, {
      method: "POST",
      body: { sheetId, kind: "cut", range: { start: "A1", end: "A1" } },
    });
    await requestJson(baseUrl, `/api/workbooks/${id}/paste`, {
      method: "POST",
      body: { sheetId, target: "F1" },
    });
    const afterCut = await (await requestJson(baseUrl, `/api/workbooks/${id}`)).json();
    assert.equal(afterCut.sheets[0].cells.F1, "Item");
    assert.equal(afterCut.sheets[0].cells.A1, "");
  } finally {
    await stopServer(child, dataDir);
  }
});

test("sorts a range over HTTP and persists the order", async () => {
  const { child, dataDir, baseUrl } = await startServer();
  try {
    const list = await requestJson(baseUrl, "/api/workbooks");
    const { workbooks } = await list.json();
    const id = workbooks[0].id;
    const detail = await requestJson(baseUrl, `/api/workbooks/${id}`);
    const workbook = await detail.json();
    const sheetId = workbook.activeSheetId;

    // write the seeded REQ-5-1-1 table over the shared seed cells
    const writes = await requestJson(baseUrl, `/api/workbooks/${id}/cells`, {
      method: "PATCH",
      body: {
        sheetId,
        updates: {
          A1: "Region",
          B1: "Sales",
          C1: "Status",
          A2: "East",
          B2: "1200",
          C2: "Open",
          A3: "North",
          B3: "800",
          C3: "Closed",
          A4: "South",
          B4: "700",
          C4: "Open",
        },
      },
    });
    assert.equal(writes.status, 200);

    const sorted = await requestJson(baseUrl, `/api/workbooks/${id}/sort`, {
      method: "PATCH",
      body: { sheetId, start: "A1", end: "C4", column: "B", order: "ascending", hasHeader: true },
    });
    assert.equal(sorted.status, 200);
    const sheet = (await sorted.json()).sheets[0];
    assert.equal(sheet.cells.A2, "South");
    assert.equal(sheet.cells.A4, "East");

    const rejected = await requestJson(baseUrl, `/api/workbooks/${id}/sort`, {
      method: "PATCH",
      body: { sheetId, start: "A1", end: "C4", column: "D", order: "ascending", hasHeader: true },
    });
    assert.equal(rejected.status, 400);
    const body = await rejected.json();
    assert.equal(body.error, "Sort column outside range");

    // unknown sort path returns 404 and the process keeps serving
    const unknown = await requestJson(baseUrl, `/api/workbooks/${id}/sort/extra`);
    assert.equal(unknown.status, 404);
    const health = await requestJson(baseUrl, "/health");
    assert.equal(health.status, 200);
  } finally {
    await stopServer(child, dataDir);
  }
});
