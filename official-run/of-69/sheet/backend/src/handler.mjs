import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { readJson, sendCsv, sendJson } from "./lib/http.mjs";
import { suggestedCsvFilename } from "./lib/csv.mjs";
import { WorkbookError } from "./lib/workbooks.mjs";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

const WORKBOOK_ROUTE = /^\/api\/workbooks\/([^/]+)$/;
const EXPORT_ROUTE = /^\/api\/workbooks\/([^/]+)\/export\.csv$/;
const WORKSHEETS_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets$/;
const WORKSHEET_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/;
const CELLS_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/;
const SELECTION_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/selection$/;
const STRUCTURE_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/(rows|columns)$/;
const RANGE_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/range$/;
const RESTORE_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/restore$/;
const FILTER_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/;
const SORT_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/;
const VALIDATIONS_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validations$/;
const PIVOTS_ROUTE = /^\/api\/workbooks\/([^/]+)\/pivots$/;
const PIVOT_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/;
const PIVOT_REFRESH_ROUTE = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/;
const IMPORT_PATH = "/api/workbooks/import";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readBody(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return null;
  }
}

export function createRequestHandler({ service, staticRoot }) {
  async function handleApi(request, response, url) {
    const { pathname } = url;
    if (pathname === "/api/workbooks" && request.method === "GET") {
      sendJson(response, 200, { workbooks: await service.list() });
      return;
    }
    if (pathname === "/api/workbooks" && request.method === "POST") {
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.create({ name: body.name });
      sendJson(response, 201, { workbook });
      return;
    }
    if (pathname === IMPORT_PATH && request.method === "POST") {
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.importCsv({ fileName: body.fileName, content: body.content });
      sendJson(response, 201, { workbook });
      return;
    }
    const exportMatch = EXPORT_ROUTE.exec(pathname);
    if (exportMatch) {
      if (request.method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const workbookId = decodeURIComponent(exportMatch[1]);
      const worksheetId = url.searchParams.get("worksheetId") ?? undefined;
      const { workbook, worksheet, csv } = await service.exportCsv(workbookId, worksheetId);
      sendCsv(response, suggestedCsvFilename(workbook.name, worksheet.name), csv);
      return;
    }
    const pivotsMatch = PIVOTS_ROUTE.exec(pathname);
    if (pivotsMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.createPivotTable(decodeURIComponent(pivotsMatch[1]), {
        sourceWorksheetId: body.sourceWorksheetId,
        range: body.range,
      });
      sendJson(response, 201, { workbook });
      return;
    }
    const pivotRefreshMatch = PIVOT_REFRESH_ROUTE.exec(pathname);
    if (pivotRefreshMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const workbook = await service.refreshPivotTable(
        decodeURIComponent(pivotRefreshMatch[1]),
        decodeURIComponent(pivotRefreshMatch[2]),
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const pivotMatch = PIVOT_ROUTE.exec(pathname);
    if (pivotMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.applyPivotTable(
        decodeURIComponent(pivotMatch[1]),
        decodeURIComponent(pivotMatch[2]),
        {
          rowField: body.rowField,
          columnField: body.columnField,
          valueField: body.valueField,
          summarizeBy: body.summarizeBy,
        },
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const worksheetsMatch = WORKSHEETS_ROUTE.exec(pathname);
    if (worksheetsMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const workbook = await service.addWorksheet(decodeURIComponent(worksheetsMatch[1]));
      sendJson(response, 201, { workbook });
      return;
    }
    const structureMatch = STRUCTURE_ROUTE.exec(pathname);
    if (structureMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.structure(
        decodeURIComponent(structureMatch[1]),
        decodeURIComponent(structureMatch[2]),
        { axis: structureMatch[3] === "rows" ? "row" : "column", action: body.action, index: body.index },
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const rangeMatch = RANGE_ROUTE.exec(pathname);
    if (rangeMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.transferRange(
        decodeURIComponent(rangeMatch[1]),
        decodeURIComponent(rangeMatch[2]),
        { mode: body.mode, source: body.source, target: body.target },
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const restoreMatch = RESTORE_ROUTE.exec(pathname);
    if (restoreMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.restoreWorksheet(
        decodeURIComponent(restoreMatch[1]),
        decodeURIComponent(restoreMatch[2]),
        body.worksheet ?? body,
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const filterMatch = FILTER_ROUTE.exec(pathname);
    if (filterMatch) {
      const workbookId = decodeURIComponent(filterMatch[1]);
      const worksheetId = decodeURIComponent(filterMatch[2]);
      if (request.method === "DELETE") {
        const workbook = await service.clearFilter(workbookId, worksheetId);
        sendJson(response, 200, { workbook });
        return;
      }
      if (request.method === "POST") {
        const body = await readBody(request, response);
        if (body === null) return;
        const workbook = await service.setFilter(workbookId, worksheetId, {
          range: body.range,
          rules: body.rules,
        });
        sendJson(response, 200, { workbook });
        return;
      }
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const sortMatch = SORT_ROUTE.exec(pathname);
    if (sortMatch) {
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.sortRange(
        decodeURIComponent(sortMatch[1]),
        decodeURIComponent(sortMatch[2]),
        { range: body.range, column: body.column, order: body.order, hasHeader: body.hasHeader },
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const validationsMatch = VALIDATIONS_ROUTE.exec(pathname);
    if (validationsMatch) {
      const workbookId = decodeURIComponent(validationsMatch[1]);
      const worksheetId = decodeURIComponent(validationsMatch[2]);
      if (request.method === "DELETE") {
        const workbook = await service.deleteValidation(
          workbookId,
          worksheetId,
          url.searchParams.get("range") ?? "",
        );
        sendJson(response, 200, { workbook });
        return;
      }
      if (request.method === "POST") {
        const body = await readBody(request, response);
        if (body === null) return;
        const workbook = await service.setValidation(workbookId, worksheetId, {
          range: body.range,
          type: body.type,
          values: body.values,
          min: body.min,
          max: body.max,
        });
        sendJson(response, 200, { workbook });
        return;
      }
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const cellsMatch = CELLS_ROUTE.exec(pathname);
    if (cellsMatch) {
      if (request.method !== "PATCH") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.writeCells(
        decodeURIComponent(cellsMatch[1]),
        decodeURIComponent(cellsMatch[2]),
        {
          updates: body.updates,
          ...(Object.hasOwn(body, "selection") ? { selection: body.selection } : {}),
        },
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const selectionMatch = SELECTION_ROUTE.exec(pathname);
    if (selectionMatch) {
      if (request.method !== "PATCH") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.setSelection(
        decodeURIComponent(selectionMatch[1]),
        decodeURIComponent(selectionMatch[2]),
        { anchor: body.anchor, focus: body.focus },
      );
      sendJson(response, 200, { workbook });
      return;
    }
    const worksheetMatch = WORKSHEET_ROUTE.exec(pathname);
    if (worksheetMatch) {
      const workbookId = decodeURIComponent(worksheetMatch[1]);
      const worksheetId = decodeURIComponent(worksheetMatch[2]);
      if (request.method === "DELETE") {
        const workbook = await service.deleteWorksheet(workbookId, worksheetId);
        sendJson(response, 200, { workbook });
        return;
      }
      if (request.method !== "PATCH") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const body = await readBody(request, response);
      if (body === null) return;
      const workbook = await service.renameWorksheet(workbookId, worksheetId, body.name);
      sendJson(response, 200, { workbook });
      return;
    }
    const match = WORKBOOK_ROUTE.exec(pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (request.method === "GET") {
        const workbook = await service.get(id);
        if (!workbook) {
          sendJson(response, 404, { error: "Workbook not found" });
          return;
        }
        sendJson(response, 200, { workbook });
        return;
      }
      if (request.method === "PATCH") {
        const body = await readBody(request, response);
        if (body === null) return;
        const workbook = await service.update(id, {
          ...(Object.hasOwn(body, "name") ? { name: body.name } : {}),
          ...(Object.hasOwn(body, "activeWorksheetId") ? { activeWorksheetId: body.activeWorksheetId } : {}),
        });
        sendJson(response, 200, { workbook });
        return;
      }
    }
    sendJson(response, 404, { error: "Not found" });
  }

  async function serveStatic(request, response, url) {
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    if (!relative || relative.includes("..") || relative.startsWith("/")) {
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
      response.writeHead(200, { "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream" });
      response.end(content);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EISDIR") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      throw error;
    }
  }

  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        if (request.method === "GET" || request.method === "HEAD") {
          sendJson(response, 200, { ok: true });
          return;
        }
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      await serveStatic(request, response, url);
    } catch (error) {
      if (error instanceof WorkbookError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: errorMessage(error) });
    }
  };
}
