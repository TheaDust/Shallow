import { readJson, sendJson } from "./lib/http.mjs";
import { HttpError } from "./workbook-service.mjs";

export function createApiHandler(service) {
  return async function handleApi(request, response, url) {
    const method = request.method;
    const path = url.pathname;
    try {
      if (method === "GET" && path === "/api/workbooks") {
        sendJson(response, 200, { workbooks: await service.listWorkbooks() });
        return;
      }
      if (method === "POST" && path === "/api/workbooks") {
        const workbook = await service.createBlankWorkbook();
        sendJson(response, 201, { workbook });
        return;
      }
      if (method === "POST" && path === "/api/workbooks/import") {
        const body = await readJson(request, { limitBytes: 50_000_000 });
        if (typeof body.fileName !== "string" || typeof body.csv !== "string") {
          sendJson(response, 400, { error: "CSV file is required." });
          return;
        }
        const workbook = await service.importWorkbook({ fileName: body.fileName, csv: body.csv });
        sendJson(response, 201, { workbook });
        return;
      }

      const rename = path.match(/^\/api\/workbooks\/([^/]+)\/rename$/);
      if (rename && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.renameWorkbook(decodeURIComponent(rename[1]), body.name);
        sendJson(response, 200, { workbook });
        return;
      }
      const addSheet = path.match(/^\/api\/workbooks\/([^/]+)\/sheets$/);
      if (addSheet && method === "POST") {
        const workbook = await service.addWorksheet(decodeURIComponent(addSheet[1]));
        sendJson(response, 200, { workbook });
        return;
      }
      const renameSheet = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/rename$/);
      if (renameSheet && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.renameSheet(
          decodeURIComponent(renameSheet[1]),
          decodeURIComponent(renameSheet[2]),
          body.name,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const deleteSheet = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/delete$/);
      if (deleteSheet && method === "POST") {
        const workbook = await service.deleteSheet(
          decodeURIComponent(deleteSheet[1]),
          decodeURIComponent(deleteSheet[2]),
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const structure = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/structure$/);
      if (structure && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.changeSheetStructure(
          decodeURIComponent(structure[1]),
          decodeURIComponent(structure[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const filter = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/filter$/);
      if (filter && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.setFilter(
          decodeURIComponent(filter[1]),
          decodeURIComponent(filter[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const validation = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/validation$/);
      if (validation && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.setValidation(
          decodeURIComponent(validation[1]),
          decodeURIComponent(validation[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const sort = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/sort$/);
      if (sort && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.sortRange(
          decodeURIComponent(sort[1]),
          decodeURIComponent(sort[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const pivot = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/pivot$/);
      if (pivot && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.applyPivot(
          decodeURIComponent(pivot[1]),
          decodeURIComponent(pivot[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const pivotRefresh = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/pivot-refresh$/);
      if (pivotRefresh && method === "POST") {
        const workbook = await service.refreshPivot(
          decodeURIComponent(pivotRefresh[1]),
          decodeURIComponent(pivotRefresh[2]),
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const pivots = path.match(/^\/api\/workbooks\/([^/]+)\/pivots$/);
      if (pivots && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.createPivot(decodeURIComponent(pivots[1]), body);
        sendJson(response, 200, { workbook });
        return;
      }
      const cells = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/cells$/);
      if (cells && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.updateCells(
          decodeURIComponent(cells[1]),
          decodeURIComponent(cells[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const transfer = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/range-transfer$/);
      if (transfer && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.transferRange(
          decodeURIComponent(transfer[1]),
          decodeURIComponent(transfer[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const restore = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/restore$/);
      if (restore && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.restoreSheet(
          decodeURIComponent(restore[1]),
          decodeURIComponent(restore[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const selection = path.match(/^\/api\/workbooks\/([^/]+)\/sheets\/([^/]+)\/selection$/);
      if (selection && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.setSelection(
          decodeURIComponent(selection[1]),
          decodeURIComponent(selection[2]),
          body,
        );
        sendJson(response, 200, { workbook });
        return;
      }
      const activeSheet = path.match(/^\/api\/workbooks\/([^/]+)\/active-sheet$/);
      if (activeSheet && method === "POST") {
        const body = await readJson(request);
        const workbook = await service.setActiveSheet(decodeURIComponent(activeSheet[1]), body.sheetId);
        sendJson(response, 200, { workbook });
        return;
      }
      const exportMatch = path.match(/^\/api\/workbooks\/([^/]+)\/export$/);
      if (exportMatch && method === "GET") {
        const { text, fileName } = await service.exportActiveSheet(decodeURIComponent(exportMatch[1]));
        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        });
        response.end(text);
        return;
      }

      const workbookMatch = path.match(/^\/api\/workbooks\/([^/]+)$/);
      if (workbookMatch && method === "GET") {
        const workbook = await service.getWorkbook(decodeURIComponent(workbookMatch[1]));
        sendJson(response, 200, { workbook });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error(error);
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
