import { useEffect, useRef, useState } from "react";

import { CreatePivotTableDialog } from "../editor/CreatePivotTableDialog";
import { DataMenu } from "../editor/DataMenu";
import { DeleteWorksheetDialog } from "../editor/DeleteWorksheetDialog";
import { DataValidationDialog } from "../editor/DataValidationDialog";
import { FilterDialog } from "../editor/FilterDialog";
import { FormulaBar } from "../editor/FormulaBar";
import { PivotTableEditor } from "../editor/PivotTableEditor";
import { RenameWorkbookDialog } from "../editor/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../editor/RenameWorksheetDialog";
import { SortRangeDialog } from "../editor/SortRangeDialog";
import { WorksheetGrid } from "../editor/WorksheetGrid";
import { WorksheetTabs } from "../editor/WorksheetTabs";
import { useWorkbook } from "../hooks/useWorkbook";
import { readClipboardText, writeClipboardText } from "../lib/clipboard";
import { downloadTextFile, worksheetCsvFileName, worksheetToCsv } from "../lib/csv";
import { parseValidationRules, ruleAt } from "../lib/data-validation";
import {
  activeFilter,
  columnCondition,
  detectDataRegion,
  distinctColumnValues,
} from "../lib/filter-view";
import { makeHash } from "../lib/hash-route";
import { pivotFieldProblem, pivotSourceFields, PIVOT_SOURCE_MESSAGE } from "../lib/pivot";
import { rangeClipboardText, selectionRectangle, type RangeClipboard } from "../lib/range-clipboard";
import { sortColumnOptions, sortableRange } from "../lib/sort-range";
import { cellCoordinate, columnLabel, normalizeRange, type CellRange } from "../lib/spreadsheet";
import { activeWorksheet, LAST_WORKSHEET_MESSAGE, type RangeTransferMode, type Worksheet } from "../lib/workbooks";
import { Button } from "../ui";

export const CLIPBOARD_UNAVAILABLE_MESSAGE =
  "Unable to read the clipboard. Press Ctrl+V to paste the clipboard content.";
export const SELECT_DATA_REGION_MESSAGE = "Select a data region with headers to create a filter";
export const SORT_RANGE_MESSAGE = "Select a range with at least two rows to sort";

export interface WorkbookEditorPageProps {
  workbookId: string;
}

export function WorkbookEditorPage({ workbookId }: WorkbookEditorPageProps) {
  const controller = useWorkbook(workbookId);
  const [renameOpen, setRenameOpen] = useState(false);
  /** Header whose filter dialog is open, and whether the data-validation dialog is open. */
  const [filterDialog, setFilterDialog] = useState<{ column: string; header: string } | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  /** Source worksheet and range of the open `Create pivot table` dialog. */
  const [pivotSource, setPivotSource] = useState<{ worksheetId: string; range: CellRange } | null>(null);
  /** Worksheet whose `Rename worksheet` dialog is open. */
  const [renameWorksheet, setRenameWorksheet] = useState<Worksheet | null>(null);
  /** Worksheet whose `Delete worksheet` confirmation is open. */
  const [deleteWorksheet, setDeleteWorksheet] = useState<Worksheet | null>(null);
  /**
   * The range this editor copied or cut. It is session state (the same as the history): an
   * in-application paste uses it, so relative references of copied formulas can follow the target
   * offset instead of arriving as plain text.
   */
  const rangeClipboardRef = useRef<RangeClipboard | null>(null);

  const { undo, redo, busy } = controller;
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  /** Ctrl+Z / Ctrl+Y perform the same operations as the toolbar buttons. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[role='dialog']")) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        void undoRef.current();
      } else if (key === "y") {
        event.preventDefault();
        void redoRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (controller.status === "loading") {
    return (
      <main className="editor">
        <p role="status" className="editor__status">Loading workbook…</p>
      </main>
    );
  }

  if (controller.status === "error" || !controller.workbook) {
    return (
      <main className="editor">
        <h1 className="editor__title">Workbook unavailable</h1>
        <p role="alert" className="editor__status">{controller.loadError}</p>
        <p><a href={makeHash("/")}>Back to workbooks</a></p>
      </main>
    );
  }

  const workbook = controller.workbook;
  const worksheet = activeWorksheet(workbook);
  const filter = activeFilter(worksheet?.filters);
  const rules = parseValidationRules(worksheet?.validations);

  /** Export reads the active worksheet only: no request, no state change. */
  const exportActiveWorksheet = () => {
    if (!worksheet) return;
    downloadTextFile(worksheetCsvFileName(workbook.name, worksheet.name), worksheetToCsv(worksheet));
  };

  /** Remembers the selected rectangle as this editor's clipboard and returns its table text. */
  const copySelection = (sheet: Worksheet | undefined, mode: RangeTransferMode): string | null => {
    if (!sheet) return null;
    const range = selectionRectangle(sheet.selection);
    const text = rangeClipboardText(sheet, range);
    rangeClipboardRef.current = { worksheetId: sheet.id, mode, range, text };
    void writeClipboardText(text);
    return text;
  };

  const transfer = (sheet: Worksheet, clipboard: RangeClipboard) => {
    const target = selectionRectangle(sheet.selection);
    void controller
      .transferRange(sheet.id, clipboard.range, target, clipboard.mode)
      .then((success) => {
        // A cut is consumed by its paste; a copy may be pasted again.
        if (success && clipboard.mode === "cut") rangeClipboardRef.current = null;
      });
  };

  /**
   * Text that arrived from the clipboard. When it is the table this editor copied or cut, the
   * rectangle is transferred through the range endpoint (values stay aligned, copied formulas
   * follow the target offset). Anything else is ordinary external content.
   */
  const pasteText = (sheet: Worksheet, text: string) => {
    const clipboard = rangeClipboardRef.current;
    if (clipboard && clipboard.worksheetId === sheet.id && (text === "" || text === clipboard.text)) {
      transfer(sheet, clipboard);
      return;
    }
    if (!text) return;
    void controller.paste(sheet.id, sheet.selection.anchor, text);
  };

  /** The `Paste` command (menu or toolbar) reads the system clipboard first. */
  const pasteFromClipboard = (sheet: Worksheet) => {
    void (async () => {
      const text = await readClipboardText();
      const clipboard = rangeClipboardRef.current;
      if (clipboard && clipboard.worksheetId === sheet.id && (text === null || text === "" || text === clipboard.text)) {
        transfer(sheet, clipboard);
        return;
      }
      if (text === null || text === "") {
        controller.reportActionError(CLIPBOARD_UNAVAILABLE_MESSAGE);
        return;
      }
      await controller.paste(sheet.id, sheet.selection.anchor, text);
    })();
  };

  const renderGrid = (sheet: Worksheet) => (
    <WorksheetGrid
      worksheet={sheet}
      busy={controller.busy}
      openFilterColumn={filterDialog?.column ?? null}
      onSelect={(range) => {
        void controller.selectCell(sheet.id, range);
      }}
      onCommitCell={(coordinate, value) => controller.commitCell(sheet.id, coordinate, value)}
      onCopySelection={(mode) => copySelection(sheet, mode)}
      onPasteText={(text) => pasteText(sheet, text)}
      onPasteFromClipboard={() => pasteFromClipboard(sheet)}
      onOpenFilter={(column, header) => setFilterDialog({ column, header })}
      onStructureChange={(change) => (change.kind === "row"
        ? controller.changeRows(sheet.id, change.action, change.index + 1)
        : controller.changeColumns(sheet.id, change.action, columnLabel(change.index)))}
    />
  );

  /**
   * Region a `Data` command works on: the rectangle the user selected, or - when only one cell is
   * selected - the contiguous data block around it, whose first row is the header row.
   */
  const resolveDataRegion = (sheet: Worksheet): CellRange => {
    const bounds = normalizeRange(sheet.selection);
    const singleCell = bounds.minRow === bounds.maxRow && bounds.minColumn === bounds.maxColumn;
    return singleCell
      ? detectDataRegion(sheet.cells, sheet.selection.anchor)
      : selectionRectangle(sheet.selection);
  };

  /** Whether a region is usable as a header row plus at least one data row. */
  const isDataRegion = (sheet: Worksheet, region: CellRange): boolean => {
    const bounds = normalizeRange({ anchor: region.start, focus: region.end });
    if (bounds.maxRow <= bounds.minRow) return false;
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      if ((sheet.cells[cellCoordinate(bounds.minRow, column)] ?? "").trim() !== "") return true;
    }
    return false;
  };

  /** `Create filter` works on the resolved data region of the active worksheet. */
  const createFilterForSelection = (sheet: Worksheet) => {
    const region = resolveDataRegion(sheet);
    if (!isDataRegion(sheet, region)) {
      controller.reportActionError(SELECT_DATA_REGION_MESSAGE);
      return;
    }
    void controller.createFilter(sheet.id, region);
  };

  /** `Create pivot table` opens the dialog for the resolved source range of the worksheet. */
  const openPivotTableDialog = (sheet: Worksheet) => {
    const region = resolveDataRegion(sheet);
    if (!isDataRegion(sheet, region)) {
      controller.reportActionError(PIVOT_SOURCE_MESSAGE);
      return;
    }
    setPivotSource({ worksheetId: sheet.id, range: region });
    controller.clearPivotError();
  };

  /**
   * The `Pivot table editor` of a pivot-result worksheet: its field options come from the header row
   * of the stored source range, so a moved or deleted source header shows up right away.
   */
  const renderPivotEditor = (sheet: Worksheet) => {
    if (!sheet.pivot) return null;
    const source = workbook.worksheets.find((item) => item.id === sheet.pivot?.source.worksheetId);
    const fields = source ? pivotSourceFields(source.cells, sheet.pivot.source.range) : [];
    return (
      <PivotTableEditor
        key={sheet.id}
        pivot={sheet.pivot}
        fields={fields}
        busy={busy}
        error={controller.pivotError ?? pivotFieldProblem(sheet.pivot, fields)}
        onApply={(settings) => {
          void controller.applyPivot(sheet.id, settings);
        }}
        onRefresh={() => {
          void controller.refreshPivot(sheet.id);
        }}
      />
    );
  };

  const dataMenu = (
    <DataMenu
      disabled={busy || !worksheet}
      onSortRange={() => setSortOpen(true)}
      onCreateFilter={() => worksheet && createFilterForSelection(worksheet)}
      onClearFilter={() => worksheet && void controller.clearFilter(worksheet.id)}
      onDataValidation={() => setValidationOpen(true)}
      onCreatePivotTable={() => worksheet && openPivotTableDialog(worksheet)}
    />
  );

  return (
    <main className="editor">
      <header className="editor__header">
        <div className="editor__title-row">
          <h1 className="editor__title">{workbook.name}</h1>
          <div className="editor__toolbar">
            <Button onClick={() => void controller.undo()} disabled={!controller.canUndo || busy}>Undo</Button>
            <Button onClick={() => void controller.redo()} disabled={!controller.canRedo || busy}>Redo</Button>
            <Button onClick={() => copySelection(worksheet, "cut")} disabled={!worksheet || busy}>Cut</Button>
            <Button onClick={() => copySelection(worksheet, "copy")} disabled={!worksheet || busy}>Copy</Button>
            <Button onClick={() => worksheet && pasteFromClipboard(worksheet)} disabled={!worksheet || busy}>
              Paste
            </Button>
            <Button onClick={exportActiveWorksheet} disabled={!worksheet}>Export CSV</Button>
            {dataMenu}
            <Button onClick={() => setRenameOpen(true)}>Rename workbook</Button>
          </div>
        </div>
        <p className="editor__meta">Last updated: {workbook.updatedAt}</p>
        <p className="editor__navigation"><a href={makeHash("/")}>Back to workbooks</a></p>
      </header>
      {controller.actionError && !renameOpen && !renameWorksheet && !deleteWorksheet && !filterDialog
        && !validationOpen && !sortOpen && !pivotSource ? (
        <div className="editor__error" role="alert">
          <p>{controller.actionError}</p>
          <Button onClick={controller.dismissActionError}>Dismiss</Button>
        </div>
      ) : null}
      {worksheet ? (
        <>
          <FormulaBar
            cellReference={worksheet.selection.anchor}
            value={worksheet.cells[worksheet.selection.anchor] ?? ""}
            busy={controller.busy}
            onCommit={(value) => controller.commitCell(worksheet.id, worksheet.selection.anchor, value)}
          />
          <WorksheetTabs
            worksheets={workbook.worksheets}
            activeId={worksheet.id}
            busy={controller.busy}
            onSelect={(id) => {
              void controller.activateWorksheet(id);
            }}
            onAdd={() => {
              void controller.addWorksheet();
            }}
            onRename={setRenameWorksheet}
            onDelete={(sheet) => {
              // The last worksheet is refused up front: no confirmation dialog is shown for it.
              if (workbook.worksheets.length <= 1) {
                controller.reportActionError(LAST_WORKSHEET_MESSAGE);
                return;
              }
              controller.dismissActionError();
              setDeleteWorksheet(sheet);
            }}
            panel={(
              <>
                {renderPivotEditor(worksheet)}
                {renderGrid(worksheet)}
              </>
            )}
          />
        </>
      ) : (
        <p role="status">This workbook has no worksheets.</p>
      )}
      <RenameWorkbookDialog
        open={renameOpen}
        currentName={workbook.name}
        busy={controller.busy}
        error={controller.actionError}
        onClose={() => {
          setRenameOpen(false);
          controller.dismissActionError();
        }}
        onSave={(name) => controller.rename(name)}
      />
      <RenameWorksheetDialog
        open={renameWorksheet !== null}
        currentName={renameWorksheet?.name ?? ""}
        busy={controller.busy}
        error={controller.actionError}
        onClose={() => {
          setRenameWorksheet(null);
          controller.dismissActionError();
        }}
        onSave={(name) => controller.renameWorksheet(renameWorksheet?.id ?? "", name)}
      />
      <DeleteWorksheetDialog
        open={deleteWorksheet !== null}
        worksheetName={deleteWorksheet?.name ?? ""}
        busy={controller.busy}
        onClose={() => {
          setDeleteWorksheet(null);
          controller.dismissActionError();
        }}
        onConfirm={() => {
          const target = deleteWorksheet;
          if (!target) return;
          void controller.deleteWorksheet(target.id).then((success) => {
            setDeleteWorksheet(null);
            if (success) controller.dismissActionError();
          });
        }}
      />
      {filterDialog && worksheet && filter ? (
        <FilterDialog
          column={filterDialog.column}
          header={filterDialog.header}
          values={distinctColumnValues(filter, worksheet.cells, filterDialog.column)}
          condition={columnCondition(filter, filterDialog.column)}
          busy={busy}
          error={controller.actionError}
          onApply={(condition) => {
            void controller
              .setColumnFilter(worksheet.id, filter.id, filterDialog.column, condition)
              .then((success) => {
                if (success) setFilterDialog(null);
              });
          }}
          onClose={() => {
            setFilterDialog(null);
            controller.dismissActionError();
          }}
        />
      ) : null}
      {sortOpen && worksheet ? (
        <SortRangeDialog
          columns={sortColumnOptions(worksheet.cells, selectionRectangle(worksheet.selection))}
          busy={busy}
          error={controller.actionError}
          onSort={(request) => {
            const range = selectionRectangle(worksheet.selection);
            if (!sortableRange(range)) {
              controller.reportActionError(SORT_RANGE_MESSAGE);
              return;
            }
            void controller.sortRange(worksheet.id, { range, ...request }).then((success) => {
              if (success) setSortOpen(false);
            });
          }}
          onClose={() => {
            setSortOpen(false);
            controller.dismissActionError();
          }}
        />
      ) : null}
      {pivotSource ? (
        <CreatePivotTableDialog
          range={pivotSource.range}
          busy={busy}
          error={controller.pivotError}
          onCreate={() => {
            void controller.createPivot(pivotSource.worksheetId, pivotSource.range).then((success) => {
              if (success) setPivotSource(null);
            });
          }}
          onClose={() => {
            setPivotSource(null);
            controller.clearPivotError();
          }}
        />
      ) : null}
      {validationOpen && worksheet ? (
        <DataValidationDialog
          range={selectionRectangle(worksheet.selection)}
          rule={ruleAt(rules, worksheet.selection.anchor)}
          busy={busy}
          error={controller.actionError}
          onSave={(payload) => {
            void controller.saveValidation(worksheet.id, payload).then((success) => {
              if (success) setValidationOpen(false);
            });
          }}
          onDelete={(ruleId) => {
            void controller.deleteValidation(worksheet.id, ruleId).then((success) => {
              if (success) setValidationOpen(false);
            });
          }}
          onClose={() => {
            setValidationOpen(false);
            controller.dismissActionError();
          }}
        />
      ) : null}
    </main>
  );
}
