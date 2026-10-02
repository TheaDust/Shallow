import { csvFileName, worksheetToCsv } from "../domain/csv";
import type { WorksheetState } from "../domain/workbook";
import { downloadTextFile } from "../lib/file-io";
import { Button } from "../ui/Button";

export interface ExportCsvButtonProps {
  workbookName: string;
  sheet: WorksheetState | undefined;
}

/** Editor toolbar action: downloads the active worksheet as CSV without changing state. */
export function ExportCsvButton({ workbookName, sheet }: ExportCsvButtonProps) {
  return (
    <Button onClick={() => downloadTextFile(csvFileName(workbookName), worksheetToCsv(sheet))}>
      Export CSV
    </Button>
  );
}
