import { csvFileName, worksheetToCsv } from "../../domain/csv";
import type { Workbook, Worksheet } from "../../domain/types";

/**
 * Starts a browser download of `text` as UTF-8 CSV under `fileName`. Uses an
 * object URL so the download needs no server round trip and cannot mutate the
 * workbook.
 */
export function startFileDownload(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Exports the active worksheet of the opened workbook as CSV. Read-only: the
 * caller's workbook state is never touched, so the active worksheet, filter
 * view, grid values and formula bar stay exactly as they were.
 */
export function exportWorksheetCsv(workbook: Workbook, worksheet: Worksheet): void {
  startFileDownload(csvFileName(workbook.name, worksheet.name), worksheetToCsv(worksheet));
}
