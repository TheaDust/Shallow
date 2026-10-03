export interface CsvExportTarget {
  workbookId: string;
  workbookName: string;
  worksheetId: string;
  worksheetName: string;
}

/** Same-origin export URL for one worksheet; the client never builds CSV text itself. */
export function worksheetExportUrl(workbookId: string, worksheetId: string): string {
  return `/api/workbooks/${encodeURIComponent(workbookId)}/export.csv?worksheetId=${encodeURIComponent(worksheetId)}`;
}

/** Suggested download name. Mirrors `backend/src/lib/csv.mjs#suggestedCsvFilename`; keep both in sync. */
export function suggestedExportFilename(workbookName: string, worksheetName: string): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${safe(workbookName) || "workbook"} - ${safe(worksheetName) || "worksheet"}.csv`;
}

/** Starts a browser download of the worksheet CSV; it only reads state, it never changes it. */
export function downloadWorksheetCsv(target: CsvExportTarget): void {
  const anchor = document.createElement("a");
  anchor.href = worksheetExportUrl(target.workbookId, target.worksheetId);
  anchor.download = suggestedExportFilename(target.workbookName, target.worksheetName);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
