import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { readJson, sendJson } from "./lib/http.mjs";
import { NotFoundError, ValidationError, createWorkbookStore } from "./store/workbooks.mjs";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

async function readBody(request, response) {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: "Invalid request body" });
    return undefined;
  }
}

async function handleApi(store, request, response, url) {
  const { pathname } = url;
  if (pathname === "/api/workbooks") {
    if (request.method === "GET") {
      sendJson(response, 200, { workbooks: await store.listWorkbooks() });
      return;
    }
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.createWorkbook({ name: body?.name });
      sendJson(response, 201, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (pathname === "/api/workbooks/import") {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.importWorkbook({ fileName: body?.fileName, rows: body?.rows });
      sendJson(response, 201, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const structureMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/structure$/.exec(pathname);
  if (structureMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.changeStructure({
        workbookId: decodeURIComponent(structureMatch[1]),
        worksheetId: decodeURIComponent(structureMatch[2]),
        axis: body?.axis,
        mode: body?.mode,
        index: body?.index,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const sortMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/sort$/.exec(pathname);
  if (sortMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.sortRange({
        workbookId: decodeURIComponent(sortMatch[1]),
        worksheetId: decodeURIComponent(sortMatch[2]),
        range: body?.range,
        column: body?.column,
        order: body?.order,
        hasHeaderRow: body?.hasHeaderRow,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const batchMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells\/batch$/.exec(pathname);
  if (batchMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.applyCellRange({
        workbookId: decodeURIComponent(batchMatch[1]),
        worksheetId: decodeURIComponent(batchMatch[2]),
        start: body?.start,
        rows: body?.rows,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const replaceMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells\/replace$/.exec(pathname);
  if (replaceMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.replaceCells({
        workbookId: decodeURIComponent(replaceMatch[1]),
        worksheetId: decodeURIComponent(replaceMatch[2]),
        updates: body?.updates,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const freezeMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/freeze$/.exec(pathname);
  if (freezeMatch) {
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.setFreeze({
        workbookId: decodeURIComponent(freezeMatch[1]),
        worksheetId: decodeURIComponent(freezeMatch[2]),
        rows: body?.rows,
        columns: body?.columns,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const transferMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/range-transfer$/.exec(pathname);
  if (transferMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.transferRange({
        workbookId: decodeURIComponent(transferMatch[1]),
        worksheetId: decodeURIComponent(transferMatch[2]),
        target: body?.target,
        rows: body?.rows,
        source: body?.source,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const stateMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/state$/.exec(pathname);
  if (stateMatch) {
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.replaceWorksheetState({
        workbookId: decodeURIComponent(stateMatch[1]),
        worksheetId: decodeURIComponent(stateMatch[2]),
        cells: body?.cells,
        validationRules: body?.validationRules,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const ruleMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/validation-rule$/.exec(pathname);
  if (ruleMatch) {
    const workbookId = decodeURIComponent(ruleMatch[1]);
    const worksheetId = decodeURIComponent(ruleMatch[2]);
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.setValidationRule({
        workbookId,
        worksheetId,
        range: body?.range,
        type: body?.type,
        min: body?.min,
        max: body?.max,
        values: body?.values,
        message: body?.message,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    if (request.method === "DELETE") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.deleteValidationRule({ workbookId, worksheetId, range: body?.range });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const conditionalMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/conditional-format$/.exec(pathname);
  if (conditionalMatch) {
    const workbookId = decodeURIComponent(conditionalMatch[1]);
    const worksheetId = decodeURIComponent(conditionalMatch[2]);
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.saveConditionalFormat({
        workbookId,
        worksheetId,
        id: body?.id,
        range: body?.range,
        condition: body?.condition,
        value: body?.value,
        style: body?.style,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    if (request.method === "DELETE") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.deleteConditionalFormat({ workbookId, worksheetId, id: body?.id });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const noteMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/notes$/.exec(pathname);
  if (noteMatch) {
    const workbookId = decodeURIComponent(noteMatch[1]);
    const worksheetId = decodeURIComponent(noteMatch[2]);
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.saveNote({
        workbookId,
        worksheetId,
        coordinate: body?.coordinate,
        text: body?.text,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    if (request.method === "DELETE") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.deleteNote({ workbookId, worksheetId, coordinate: body?.coordinate });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const namedRangesMatch = /^\/api\/workbooks\/([^/]+)\/named-ranges$/.exec(pathname);
  if (namedRangesMatch) {
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.saveNamedRange({
        workbookId: decodeURIComponent(namedRangesMatch[1]),
        id: body?.id,
        name: body?.name,
        range: body?.range,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const filterMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/filter$/.exec(pathname);
  if (filterMatch) {
    const workbookId = decodeURIComponent(filterMatch[1]);
    const worksheetId = decodeURIComponent(filterMatch[2]);
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.setFilter({ workbookId, worksheetId, filter: body?.filter });
      sendJson(response, 200, { workbook });
      return;
    }
    if (request.method === "DELETE") {
      const workbook = await store.clearFilter({ workbookId, worksheetId });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const filterViewApplyMatch = /^\/api\/workbooks\/([^/]+)\/filter-views\/([^/]+)\/apply$/.exec(pathname);
  if (filterViewApplyMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.applyFilterView({
        workbookId: decodeURIComponent(filterViewApplyMatch[1]),
        viewId: decodeURIComponent(filterViewApplyMatch[2]),
        worksheetId: body?.worksheetId,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const filterViewMatch = /^\/api\/workbooks\/([^/]+)\/filter-views\/([^/]+)$/.exec(pathname);
  if (filterViewMatch) {
    if (request.method === "DELETE") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.deleteFilterView({
        workbookId: decodeURIComponent(filterViewMatch[1]),
        viewId: decodeURIComponent(filterViewMatch[2]),
        worksheetId: body?.worksheetId,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const filterViewsMatch = /^\/api\/workbooks\/([^/]+)\/filter-views$/.exec(pathname);
  if (filterViewsMatch) {
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.saveFilterView({
        workbookId: decodeURIComponent(filterViewsMatch[1]),
        name: body?.name,
        filter: body?.filter,
      });
      sendJson(response, 201, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const pivotRefreshMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot\/refresh$/.exec(pathname);
  if (pivotRefreshMatch) {
    if (request.method === "POST") {
      const workbook = await store.refreshPivotTable({
        workbookId: decodeURIComponent(pivotRefreshMatch[1]),
        worksheetId: decodeURIComponent(pivotRefreshMatch[2]),
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const pivotMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/pivot$/.exec(pathname);
  if (pivotMatch) {
    const workbookId = decodeURIComponent(pivotMatch[1]);
    const worksheetId = decodeURIComponent(pivotMatch[2]);
    if (request.method === "POST") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.createPivotTable({
        workbookId,
        sourceWorksheetId: worksheetId,
        range: body?.range,
      });
      sendJson(response, 201, { workbook });
      return;
    }
    if (request.method === "PUT") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.applyPivotConfig({
        workbookId,
        worksheetId,
        rowField: body?.rowField,
        columnField: body?.columnField,
        valueField: body?.valueField,
        summarizeBy: body?.summarizeBy,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const selectionMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/selection$/.exec(pathname);
  if (selectionMatch) {
    if (request.method === "PATCH") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.selectRange({
        workbookId: decodeURIComponent(selectionMatch[1]),
        worksheetId: decodeURIComponent(selectionMatch[2]),
        anchor: body?.anchor,
        focus: body?.focus,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const cellMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)\/cells$/.exec(pathname);
  if (cellMatch) {
    if (request.method === "PATCH") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.updateCell({
        workbookId: decodeURIComponent(cellMatch[1]),
        worksheetId: decodeURIComponent(cellMatch[2]),
        coordinate: body?.coordinate,
        value: body?.value,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const worksheetsMatch = /^\/api\/workbooks\/([^/]+)\/worksheets$/.exec(pathname);
  if (worksheetsMatch) {
    if (request.method === "POST") {
      const workbook = await store.addWorksheet({
        workbookId: decodeURIComponent(worksheetsMatch[1]),
      });
      sendJson(response, 201, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const worksheetMatch = /^\/api\/workbooks\/([^/]+)\/worksheets\/([^/]+)$/.exec(pathname);
  if (worksheetMatch) {
    if (request.method === "DELETE") {
      const workbook = await store.deleteWorksheet({
        workbookId: decodeURIComponent(worksheetMatch[1]),
        worksheetId: decodeURIComponent(worksheetMatch[2]),
      });
      sendJson(response, 200, { workbook });
      return;
    }
    if (request.method === "PATCH") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      const workbook = await store.renameWorksheet({
        workbookId: decodeURIComponent(worksheetMatch[1]),
        worksheetId: decodeURIComponent(worksheetMatch[2]),
        name: body?.name,
      });
      sendJson(response, 200, { workbook });
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const match = /^\/api\/workbooks\/([^/]+)$/.exec(pathname);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (request.method === "GET") {
      const workbook = await store.getWorkbook(id);
      if (!workbook) {
        sendJson(response, 404, { error: "Workbook not found" });
        return;
      }
      sendJson(response, 200, { workbook });
      return;
    }
    if (request.method === "PATCH") {
      const body = await readBody(request, response);
      if (body === undefined) return;
      try {
        const workbook = await store.updateWorkbook(id, {
          name: body?.name,
          activeWorksheetId: body?.activeWorksheetId,
        });
        sendJson(response, 200, { workbook });
      } catch (error) {
        if (error instanceof ValidationError || error instanceof NotFoundError) {
          sendJson(response, error.status, { error: error.message });
          return;
        }
        throw error;
      }
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function serveStatic(staticRoot, request, response, url) {
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!relative || relative.includes("..")) {
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
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

/**
 * Builds the application request handler. Static assets resolve from
 * `staticRoot` and workbook state persists under `dataDir` (SHALLOW_DATA_DIR).
 */
export function createRequestHandler({ dataDir, staticRoot }) {
  const store = createWorkbookStore({ dataDir });

  return async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        await handleApi(store, request, response, url);
        return;
      }
      if (request.method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      await serveStatic(staticRoot, request, response, url);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
