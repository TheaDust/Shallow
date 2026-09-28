import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, sendJson } from "./lib/http.mjs";
import { ApiError, createWorkbookService } from "./lib/workbooks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const extraPorts = JSON.parse(await readFile(join(here, "platform-ports.json"), "utf8"));
const dataDir = process.env.SHALLOW_DATA_DIR ?? resolve(here, "../../.data");
const workbooks = createWorkbookService(dataDir);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

async function handleApi(request, response, segments, url) {
  const [first, second, third] = segments.slice(1);
  if (first === "import-csv") {
    if (request.method === "POST") {
      const body = await readJson(request, { limitBytes: 20_000_000 });
      const workbook = await workbooks.importCsv(body.fileName, body.content);
      sendJson(response, 201, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  if (first !== "workbooks") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (second === undefined) {
    if (request.method === "GET") {
      sendJson(response, 200, { workbooks: await workbooks.list() });
      return;
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const workbook = await workbooks.create(body.name);
      sendJson(response, 201, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const id = decodeURIComponent(second);
  if (third === undefined) {
    if (request.method === "GET") {
      sendJson(response, 200, await workbooks.get(id));
      return;
    }
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const workbook = await workbooks.rename(id, body.name);
      sendJson(response, 200, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (third === "export-csv" && request.method === "GET") {
    const { fileName, content } = await workbooks.exportSheetCsv(id);
    response.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
    });
    response.end(content);
    return;
  }

  if (third === "sheets") {
    if (segments.length === 4 && request.method === "POST") {
      const workbook = await workbooks.addSheet(id);
      sendJson(response, 200, workbook);
      return;
    }
    if (segments.length === 5 && request.method === "PATCH") {
      const body = await readJson(request);
      const sheetId = decodeURIComponent(segments[4]);
      const workbook = await workbooks.renameSheet(id, sheetId, body.name);
      sendJson(response, 200, workbook);
      return;
    }
    if (segments.length === 5 && request.method === "DELETE") {
      const sheetId = decodeURIComponent(segments[4]);
      const workbook = await workbooks.deleteSheet(id, sheetId);
      sendJson(response, 200, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (third === "rows") {
    if (request.method === "POST") {
      const body = await readJson(request);
      const workbook = await workbooks.insertRow(id, body.sheetId, body.index, body.position);
      sendJson(response, 200, workbook);
      return;
    }
    if (request.method === "DELETE") {
      const body = await readJson(request);
      const workbook = await workbooks.deleteRow(id, body.sheetId, body.index);
      sendJson(response, 200, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (third === "columns") {
    if (request.method === "POST") {
      const body = await readJson(request);
      const workbook = await workbooks.insertColumn(id, body.sheetId, body.index, body.position);
      sendJson(response, 200, workbook);
      return;
    }
    if (request.method === "DELETE") {
      const body = await readJson(request);
      const workbook = await workbooks.deleteColumn(id, body.sheetId, body.index);
      sendJson(response, 200, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (third === "pivot") {
    if (segments.length === 4 && segments[3] === "refresh" && request.method === "POST") {
      const body = await readJson(request);
      const workbook = await workbooks.refreshPivot(id, body.sheetId);
      sendJson(response, 200, workbook);
      return;
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const workbook = await workbooks.createPivotTable(id, body.sheetId, body.range);
      sendJson(response, 200, workbook);
      return;
    }
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const workbook = await workbooks.applyPivotConfig(id, body.sheetId, body.config);
      sendJson(response, 200, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (third === "cells" && request.method === "PATCH") {
    const body = await readJson(request, { limitBytes: 20_000_000 });
    const workbook = await workbooks.updateCells(id, body.sheetId, body.updates);
    sendJson(response, 200, workbook);
    return;
  }

  if (third === "state" && request.method === "PATCH") {
    const body = await readJson(request);
    const workbook = await workbooks.updateState(
      id,
      body.sheetId,
      body.selectedCell,
      body.selectedRange,
    );
    sendJson(response, 200, workbook);
    return;
  }

  if (third === "sort" && request.method === "PATCH") {
    const body = await readJson(request);
    const workbook = await workbooks.sortRange(id, body.sheetId, body);
    sendJson(response, 200, workbook);
    return;
  }

  if (third === "filter" && request.method === "PATCH") {
    const body = await readJson(request);
    const workbook = await workbooks.updateFilter(id, body.sheetId, body.filter ?? null);
    sendJson(response, 200, workbook);
    return;
  }

  if (third === "validation") {
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const workbook = await workbooks.saveValidationRule(id, body.sheetId, body);
      sendJson(response, 200, workbook);
      return;
    }
    if (request.method === "DELETE") {
      const body = await readJson(request);
      const workbook = await workbooks.deleteValidationRule(id, body.sheetId, body.ruleId);
      sendJson(response, 200, workbook);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (third === "clipboard" && request.method === "POST") {
    const body = await readJson(request);
    const workbook = await workbooks.captureClipboard(id, body.sheetId, body.kind, body.range);
    sendJson(response, 200, workbook);
    return;
  }

  if (third === "paste" && request.method === "POST") {
    const body = await readJson(request);
    const workbook = await workbooks.pasteClipboard(id, body.sheetId, body.target);
    sendJson(response, 200, workbook);
    return;
  }

  if (third === "undo" && request.method === "POST") {
    sendJson(response, 200, await workbooks.undo(id));
    return;
  }

  if (third === "redo" && request.method === "POST") {
    sendJson(response, 200, await workbooks.redo(id));
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function handler(request, response) {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
      sendJson(response, 200, { ok: true });
      return;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "api") {
      await handleApi(request, response, segments, url);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!relative || relative.includes("..") || relative.startsWith("api/")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    try {
      const content = await readFile(join(staticRoot, relative));
      response.writeHead(200, {
        "content-type": contentTypes.get(extname(relative)) ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const primaryPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(primaryPort) || primaryPort <= 0 || primaryPort > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const ports = [
  primaryPort,
  ...(process.env.ARC_EXTRA_PORTS === "0" ? [] : extraPorts),
].filter((port, index, all) => Number.isInteger(port) && port > 0 && port <= 65535 && all.indexOf(port) === index);

const servers = ports.map((port) => createServer((request, response) => {
  void handler(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`application listening on ${port}`);
}));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const server of servers) server.close();
  });
}
