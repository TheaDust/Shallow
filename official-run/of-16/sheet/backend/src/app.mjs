import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { DomainError } from "./domain/workbooks.mjs";
import { readJson, sendJson } from "./lib/http.mjs";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
]);

function errorStatus(error) {
  if (error instanceof DomainError) return error.status;
  return 500;
}

function errorMessage(error) {
  if (error instanceof DomainError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

async function readBody(request) {
  try {
    return await readJson(request);
  } catch (error) {
    throw new DomainError(
      error instanceof Error && error.message === "Request body is too large"
        ? error.message
        : "Invalid JSON body",
      400,
    );
  }
}

/**
 * Routes `/api/**` requests. Returns true when the request was handled.
 */
async function handleApi(request, response, pathname, service) {
  if (pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (pathname === "/api/workbooks") {
    if (request.method === "GET") {
      sendJson(response, 200, { workbooks: await service.list() });
      return true;
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 201, { workbook: await service.create(body) });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (pathname === "/api/workbooks/import" && request.method === "POST") {
    const body = await readBody(request);
    sendJson(response, 201, { workbook: await service.importCsv(body ?? {}) });
    return true;
  }

  const workbookMatch = /^\/api\/workbooks\/([^/]+)$/.exec(pathname);
  if (workbookMatch) {
    const id = decodeURIComponent(workbookMatch[1]);
    if (request.method === "GET") {
      sendJson(response, 200, { workbook: await service.get(id) });
      return true;
    }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      if (body && typeof body === "object" && typeof body.name === "string") {
        sendJson(response, 200, { workbook: await service.rename(id, body.name) });
        return true;
      }
      sendJson(response, 200, { workbook: await service.updateState(id, body ?? {}) });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const stateMatch = /^\/api\/workbooks\/([^/]+)\/state$/.exec(pathname);
  if (stateMatch) {
    const id = decodeURIComponent(stateMatch[1]);
    if (request.method === "PATCH") {
      sendJson(response, 200, { workbook: await service.updateState(id, await readBody(request)) });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const worksheetsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets$/.exec(pathname);
  if (worksheetsMatch) {
    const id = decodeURIComponent(worksheetsMatch[1]);
    if (request.method === "POST") {
      sendJson(response, 201, { workbook: await service.addWorksheet(id) });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const worksheetMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(pathname);
  if (worksheetMatch) {
    const id = decodeURIComponent(worksheetMatch[1]);
    const worksheetId = decodeURIComponent(worksheetMatch[2]);
    if (request.method === "PATCH") {
      const body = await readBody(request);
      sendJson(response, 200, {
        workbook: await service.renameWorksheet(id, worksheetId, body?.name),
      });
      return true;
    }
    // Undo/redo restore the complete worksheet snapshot (REQ-3-2-2).
    if (request.method === "PUT") {
      const body = await readBody(request);
      sendJson(response, 200, {
        workbook: await service.replaceWorksheet(id, worksheetId, body ?? {}),
      });
      return true;
    }
    // Worksheet lifecycle (REQ-2-1-4): removing a tab answers with the whole
    // updated workbook so the remaining tabs and the active state are clear.
    if (request.method === "DELETE") {
      sendJson(response, 200, {
        workbook: await service.deleteWorksheet(id, worksheetId),
      });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const cellsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/.exec(pathname);
  if (cellsMatch) {
    const id = decodeURIComponent(cellsMatch[1]);
    const worksheetId = decodeURIComponent(cellsMatch[2]);
    if (request.method === "PATCH") {
      const body = await readBody(request);
      sendJson(response, 200, {
        workbook: await service.updateCells(id, worksheetId, body?.cells ?? body),
      });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  // Row/column structure changes (REQ-2-2): POST /rows or /columns with
  // `{ action, index }`; the response carries the whole updated workbook.
  const structureMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/(rows|columns)$/.exec(pathname);
  if (structureMatch) {
    const id = decodeURIComponent(structureMatch[1]);
    const worksheetId = decodeURIComponent(structureMatch[2]);
    const axis = structureMatch[3] === "rows" ? "row" : "column";
    if (request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, {
        workbook: await service.changeStructure(id, worksheetId, axis, body ?? {}),
      });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  // Sorting of one selected rectangle (REQ-5-1-1): POST /sort with
  // `{ range, column, order, hasHeaderRow }`; the response carries the updated
  // workbook so the grid renders the new row order.
  const sortMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/.exec(pathname);
  if (sortMatch) {
    const id = decodeURIComponent(sortMatch[1]);
    const worksheetId = decodeURIComponent(sortMatch[2]);
    if (request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, {
        workbook: await service.sortRange(id, worksheetId, body ?? {}),
      });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  // Organization state of one worksheet: the complete validation rule list
  // (`PUT .../validations`) and the filter view (`PUT .../filter`, an explicit
  // `null` clears it). Both answer with the whole updated workbook.
  const rulesMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/(validations|filter)$/.exec(pathname);
  if (rulesMatch) {
    const id = decodeURIComponent(rulesMatch[1]);
    const worksheetId = decodeURIComponent(rulesMatch[2]);
    if (request.method === "PUT") {
      const body = await readBody(request);
      const workbook = rulesMatch[3] === "filter"
        ? await service.setFilter(id, worksheetId, body ?? {})
        : await service.replaceValidations(id, worksheetId, body ?? {});
      sendJson(response, 200, { workbook });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  // Pivot summarization (REQ-5-3-1): `POST /pivot` creates the PivotN result
  // worksheet from a source range; `PUT .../worksheets/:id/pivot` stores the
  // chosen fields and recomputes; `POST .../pivot/refresh` recomputes from the
  // stored configuration. Every answer carries the whole updated workbook.
  const pivotCreateMatch = /^\/api\/workbooks\/([^/]+)\/pivot$/.exec(pathname);
  if (pivotCreateMatch) {
    const id = decodeURIComponent(pivotCreateMatch[1]);
    if (request.method === "POST") {
      sendJson(response, 201, { workbook: await service.createPivot(id, await readBody(request)) });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  const pivotMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot(\/refresh)?$/.exec(pathname);
  if (pivotMatch) {
    const id = decodeURIComponent(pivotMatch[1]);
    const worksheetId = decodeURIComponent(pivotMatch[2]);
    if (request.method === "POST" && pivotMatch[3]) {
      sendJson(response, 200, { workbook: await service.refreshPivot(id, worksheetId) });
      return true;
    }
    if (request.method === "PUT" && !pivotMatch[3]) {
      sendJson(response, 200, {
        workbook: await service.configurePivot(id, worksheetId, await readBody(request)),
      });
      return true;
    }
    sendJson(response, 404, { error: "Not found" });
    return true;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found" });
    return true;
  }
  return false;
}

async function serveStatic(request, response, pathname, staticRoot) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!relative || relative.includes("..")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const filePath = resolve(join(staticRoot, relative));
  if (!filePath.startsWith(resolve(staticRoot))) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES.get(extname(relative)) ?? "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

export function createRequestHandler({ service, staticRoot }) {
  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      let pathname = url.pathname;
      try {
        pathname = decodeURI(pathname);
      } catch {
        // Keep the raw path; it will not match any known route or file.
      }
      if (pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (await handleApi(request, response, pathname, service)) return;
      await serveStatic(request, response, pathname, staticRoot);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: errorMessage(error) });
    }
  };
}
