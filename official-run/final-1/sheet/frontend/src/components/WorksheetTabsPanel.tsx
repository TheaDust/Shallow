import { useState } from "react";

import { DeleteWorksheetDialog } from "./DeleteWorksheetDialog";
import { RenameWorksheetDialog } from "./RenameWorksheetDialog";
import { WorksheetTabs } from "./WorksheetTabs";
import { LAST_WORKSHEET_MESSAGE, type Workbook } from "../domain/types";
import { addWorksheet, deleteWorksheet, renameWorksheet, setActiveWorksheet } from "../lib/workbook-api";

/** Id of the grid panel the active tab points at with `aria-controls`. */
export const GRID_PANEL_ID = "worksheet-grid-panel";

export interface WorksheetTabsPanelProps {
  workbook: Workbook;
  /** Replaces the editor's workbook state with the server's stored state. */
  onWorkbookChange(workbook: Workbook): void;
}

/** Name of the worksheet being renamed, or an empty string when it is gone. */
function worksheetName(workbook: Workbook, worksheetId: string): string {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId)?.name ?? "";
}

/**
 * Worksheet tab bar with its own management flow: switching the active tab,
 * adding a worksheet, renaming one and deleting one (through a confirmation).
 * Every change is persisted first and replaces the stored workbook, so a
 * rejected operation reports its message and leaves the tabs as they were.
 */
export function WorksheetTabsPanel({ workbook, onWorkbookChange }: WorksheetTabsPanelProps) {
  const [renameWorksheetId, setRenameWorksheetId] = useState<string | null>(null);
  const [deleteWorksheetId, setDeleteWorksheetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Switches the active tab; a failed call puts the previous workbook back. */
  const switchWorksheet = async (worksheetId: string) => {
    if (worksheetId === workbook.activeWorksheetId) return;
    const previous = workbook;
    onWorkbookChange({ ...workbook, activeWorksheetId: worksheetId });
    try {
      onWorkbookChange(await setActiveWorksheet(workbook.id, worksheetId));
    } catch {
      onWorkbookChange(previous);
    }
  };

  /** Adds a blank worksheet (first unused SheetN name) and switches to it. */
  const addWorksheetTab = async () => {
    setError(null);
    try {
      onWorkbookChange(await addWorksheet(workbook.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add worksheet");
    }
  };

  const saveWorksheetName = async (name: string) => {
    if (!renameWorksheetId) return;
    onWorkbookChange(await renameWorksheet(workbook.id, renameWorksheetId, name));
  };

  /**
   * Asks to delete a worksheet. A workbook always keeps one worksheet, so the
   * last remaining tab reports the message directly without opening the
   * confirmation dialog; otherwise the confirmation describes the target.
   */
  const requestDeleteWorksheet = (worksheetId: string) => {
    setError(null);
    if (workbook.worksheets.length <= 1) {
      setError(LAST_WORKSHEET_MESSAGE);
      return;
    }
    setDeleteWorksheetId(worksheetId);
  };

  /**
   * Deletes the confirmed worksheet. The server keeps at least one worksheet
   * and rejects one a pivot result still reads, so a rejection reports its
   * message and leaves the target tab as it was.
   */
  const performDeleteWorksheet = async () => {
    if (!deleteWorksheetId) return;
    setError(null);
    try {
      onWorkbookChange(await deleteWorksheet(workbook.id, deleteWorksheetId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete worksheet");
    }
  };

  return (
    <>
      <WorksheetTabs
        worksheets={workbook.worksheets}
        activeWorksheetId={workbook.activeWorksheetId}
        gridId={GRID_PANEL_ID}
        onChange={switchWorksheet}
        onAdd={addWorksheetTab}
        onRename={setRenameWorksheetId}
        onDelete={requestDeleteWorksheet}
      />
      {error ? <p role="alert">{error}</p> : null}
      <RenameWorksheetDialog
        open={renameWorksheetId !== null}
        currentName={renameWorksheetId ? worksheetName(workbook, renameWorksheetId) : ""}
        onOpenChange={(open) => {
          if (!open) setRenameWorksheetId(null);
        }}
        onSave={saveWorksheetName}
      />
      <DeleteWorksheetDialog
        open={deleteWorksheetId !== null}
        worksheetName={deleteWorksheetId ? worksheetName(workbook, deleteWorksheetId) : ""}
        onOpenChange={(open) => {
          if (!open) setDeleteWorksheetId(null);
        }}
        onDelete={performDeleteWorksheet}
      />
    </>
  );
}
