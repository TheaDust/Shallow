import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  listWorkbooks,
  getWorkbook,
  createWorkbook,
  renameWorkbook,
  addSheet,
  renameSheet,
  importCsvWorkbook,
  modifyRows,
  modifyColumns,
  pasteCells,
  transferCells,
  setCellValue,
  setSelection,
} from "./store.js";
import { INVALID_CSV_MESSAGE } from "./csv.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(SERVER_DIR, "..", "..", "frontend", "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.length > 1_000_000) {
      const err = new Error("Request body too large");
      err.status = 413;
      throw err;
    }
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function jsonError(res, status, message, code) {
  sendJson(res, status, { error: { code: code || "ERROR", message } });
}

/** Resolve an API pathname against the workbook routes. */
function matchWorkbookRoute(pathname, method) {
  const m = pathname.match(/^\/api\/workbooks\/([^/]+)$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]), method };
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/import-csv" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, INVALID_CSV_MESSAGE, "INVALID_CSV");
      return;
    }
    if (typeof body?.csv !== "string" || typeof body?.fileName !== "string") {
      jsonError(res, 400, INVALID_CSV_MESSAGE, "INVALID_CSV");
      return;
    }
    const result = await importCsvWorkbook(body.fileName, body.csv);
    if (result.error) {
      jsonError(res, 400, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 201, { workbook: result.workbook });
    return;
  }
  if (pathname === "/api/workbooks" && req.method === "GET") {
    sendJson(res, 200, { workbooks: await listWorkbooks() });
    return;
  }
  if (pathname === "/api/workbooks" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const workbook = await createWorkbook(body.name);
    sendJson(res, 201, { workbook });
    return;
  }
  const sheetsMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets$/);
  if (sheetsMatch && req.method === "POST") {
    const result = await addSheet(decodeURIComponent(sheetsMatch[1]));
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 201, { workbook: result.workbook });
    return;
  }
  const rowsMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/rows$/);
  if (rowsMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await modifyRows(
      decodeURIComponent(rowsMatch[1]),
      decodeURIComponent(rowsMatch[2]),
      body.action,
      body.row,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const columnsMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/columns$/);
  if (columnsMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await modifyColumns(
      decodeURIComponent(columnsMatch[1]),
      decodeURIComponent(columnsMatch[2]),
      body.action,
      body.column,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const pasteMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/paste$/);
  if (pasteMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await pasteCells(
      decodeURIComponent(pasteMatch[1]),
      decodeURIComponent(pasteMatch[2]),
      body.start,
      body.text,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const transferMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/transfer$/);
  if (transferMatch && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await transferCells(
      decodeURIComponent(transferMatch[1]),
      decodeURIComponent(transferMatch[2]),
      body.operation,
      body.source,
      body.target,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const cellMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/cells\/([^/]+)$/);
  if (cellMatch && req.method === "PATCH") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await setCellValue(
      decodeURIComponent(cellMatch[1]),
      decodeURIComponent(cellMatch[2]),
      decodeURIComponent(cellMatch[3]),
      body.value,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const selectionMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/selection$/);
  if (selectionMatch && req.method === "PATCH") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await setSelection(
      decodeURIComponent(selectionMatch[1]),
      decodeURIComponent(selectionMatch[2]),
      body.current,
      body.end,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const sheetMatch = pathname.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)$/);
  if (sheetMatch && req.method === "PATCH") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
      return;
    }
    const result = await renameSheet(
      decodeURIComponent(sheetMatch[1]),
      decodeURIComponent(sheetMatch[2]),
      body.name,
    );
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 400;
      jsonError(res, status, result.error.message, result.error.code);
      return;
    }
    sendJson(res, 200, { workbook: result.workbook });
    return;
  }
  const route = matchWorkbookRoute(pathname, req.method);
  if (route) {
    if (route.method === "GET") {
      const workbook = await getWorkbook(route.id);
      if (!workbook) {
        jsonError(res, 404, "Workbook not found", "NOT_FOUND");
        return;
      }
      sendJson(res, 200, { workbook });
      return;
    }
    if (route.method === "PATCH") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        jsonError(res, err.status === 413 ? 413 : 400, "Invalid request body");
        return;
      }
      const result = await renameWorkbook(route.id, body.name);
      if (result.error) {
        const status = result.error.code === "NOT_FOUND" ? 404 : 400;
        jsonError(res, status, result.error.message, result.error.code);
        return;
      }
      sendJson(res, 200, { workbook: result.workbook });
      return;
    }
    jsonError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
    return;
  }
  jsonError(res, 404, "Not found", "NOT_FOUND");
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(DIST_DIR, rel);
  if (!filePath.startsWith(path.resolve(DIST_DIR) + path.sep) && filePath !== path.resolve(DIST_DIR, "index.html")) {
    sendText(res, 404, "Not found");
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error("not a file");
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": content.length,
    });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  try {
    if (pathname === "/health" || pathname === "/api/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    try {
      jsonError(res, 500, "Internal server error", "INTERNAL");
    } catch {
      /* response already sent */
    }
  }
}

/** Shared handler factory so tests can create their own server instances. */
export function createApp() {
  return http.createServer(handleRequest);
}

function isMain() {
  if (!process.argv[1]) return false;
  const entry = path.resolve(process.argv[1]);
  return import.meta.url === pathToFileURL(entry).href;
}

function start() {
  const PORT = Number(process.env.PORT || 3000);
  const skipExtra = process.env.ARC_EXTRA_PORTS === "0";
  const ports = skipExtra ? [PORT] : [PORT, 3301];
  for (const port of ports) {
    const server = createApp();
    server.on("error", (err) => {
      console.error(`Failed to listen on port ${port}: ${err.message}`);
      process.exit(1);
    });
    server.listen(port, () => {
      console.log(`Spreadsheet backend listening on http://0.0.0.0:${port}`);
    });
  }
}

if (isMain()) {
  start();
}
