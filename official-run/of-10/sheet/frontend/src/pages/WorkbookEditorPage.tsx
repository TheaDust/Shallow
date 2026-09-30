import { useState } from "react";

import { DataValidationDialog } from "../editor/DataValidationDialog";
import { CreatePivotTableDialog } from "../editor/CreatePivotTableDialog";
import { DeleteWorksheetDialog } from "../workbooks/DeleteWorksheetDialog";
import { EditorToolbar } from "../editor/EditorToolbar";
import { FilterDialog } from "../editor/FilterDialog";
import { FormulaBar } from "../editor/FormulaBar";
import { PivotTableEditor } from "../editor/PivotTableEditor";
import { SortRangeDialog } from "../editor/SortRangeDialog";
import { WorksheetGrid } from "../editor/WorksheetGrid";
import { WorksheetTabs } from "../editor/WorksheetTabs";
import { selectionRegion } from "../editor/selection";
import { structureChangeOf } from "../editor/structure";
import { columnFilterOf, filterHeaderText, sameRegion, withColumnFilter } from "../editor/filters";
import { useSpreadsheetSession } from "../editor/useSpreadsheetSession";
import type { CellRegion } from "../lib/cells";
import { Button } from "../ui";
import { downloadTextFile } from "../lib/download";
import { exportFileName, worksheetToCsv } from "../workbooks/csv";
import { formatLastUpdated } from "../workbooks/format";
import { RenameWorkbookDialog } from "../workbooks/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../workbooks/RenameWorksheetDialog";
import { LAST_WORKSHEET_MESSAGE } from "../workbooks/worksheet-messages";
import type { ValidationRuleData, WorksheetData } from "../workbooks/types";

export interface WorkbookEditorPageProps {
  workbookId: string;
}

const SINGLE_CELL_REGION: CellRegion = { top: 1, bottom: 1, left: 1, right: 1 };

export function WorkbookEditorPage({ workbookId }: WorkbookEditorPageProps) {
  const session = useSpreadsheetSession(workbookId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameWorksheetTarget, setRenameWorksheetTarget] = useState<WorksheetData | null>(null);
  const [deleteWorksheetTarget, setDeleteWorksheetTarget] = useState<WorksheetData | null>(null);
  const [filterColumn, setFilterColumn] = useState<number | null>(null);
  const [validationTarget, setValidationTarget] = useState<CellRegion | null>(null);
  const [pivotSourceRange, setPivotSourceRange] = useState<CellRegion | null>(null);
  const [sortTarget, setSortTarget] = useState<CellRegion | null>(null);
  const { workbook, activeWorksheet } = session;

  if (session.status === "loading") {
    return (
      <main>
        <h1>Workbook</h1>
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  if (session.status === "error" || !workbook || !activeWorksheet) {
    return (
      <main>
        <h1>Workbook</h1>
        <p role="alert">{session.errorMessage}</p>
        <p>
          <a href="#/">All workbooks</a>
        </p>
      </main>
    );
  }

  const exportActiveWorksheet = () => {
    downloadTextFile(exportFileName(workbook.name, activeWorksheet.name), worksheetToCsv(activeWorksheet));
  };

  const filter = activeWorksheet.filter ?? null;
  const openFilterColumn = filterColumn !== null && filter ? filterColumn : null;
  const pivot = activeWorksheet.pivot ?? null;
  /** Worksheet a pivot result reads; a pivot whose source disappeared reports it in the editor. */
  const pivotSource =
    pivot === null ? null : workbook.worksheets.find((worksheet) => worksheet.id === pivot.sourceWorksheetId) ?? null;

  /** Rule the dialog reopens: the one covering the active cell, otherwise the one of the range. */
  const existingRule: ValidationRuleData | null = (() => {
    if (!validationTarget) return null;
    const rules = activeWorksheet.validations ?? [];
    const activeCell = session.selection.focus;
    const covering = rules.find(
      (rule) =>
        activeCell.row >= rule.range.top &&
        activeCell.row <= rule.range.bottom &&
        activeCell.column >= rule.range.left &&
        activeCell.column <= rule.range.right,
    );
    return covering ?? rules.find((rule) => sameRegion(rule.range, validationTarget)) ?? null;
  })();

  return (
    <main className="editor">
      <header className="editor__header">
        <p className="editor__nav">
          <a href="#/">All workbooks</a>
        </p>
        <div className="editor__title-row">
          <h1 className="editor__title">{workbook.name}</h1>
          <Button onClick={() => setRenameOpen(true)}>Rename workbook</Button>
        </div>
        <p className="editor__updated">Last updated: {formatLastUpdated(workbook.updatedAt)}</p>
      </header>
      <EditorToolbar
        canUndo={session.canUndo}
        canRedo={session.canRedo}
        busy={session.busy}
        onUndo={() => {
          void session.undo();
        }}
        onRedo={() => {
          void session.redo();
        }}
        onCut={() => {
          session.cutRange();
        }}
        onCopy={() => {
          session.copyRange();
        }}
        onPaste={() => {
          void session.pasteFromClipboard();
        }}
        onExport={exportActiveWorksheet}
        data={{
          onCreateFilter: () => {
            void session.createFilter();
          },
          onSortRange: () => {
            const region = session.sortSourceRegion();
            if (region) setSortTarget(region);
          },
          onCreatePivotTable: () => {
            const region = session.pivotSourceRegion();
            if (region) setPivotSourceRange(region);
          },
          onClearFilter: () => {
            setFilterColumn(null);
            void session.clearFilter();
          },
          onDataValidation: () => setValidationTarget(selectionRegion(session.selection)),
        }}
      />
      <FormulaBar
        cellId={session.activeCellId}
        value={session.formulaBarText}
        onChange={session.changeEdit}
        onCommit={() => {
          void session.commitEdit();
        }}
        onCancel={session.cancelEdit}
      />
      {session.notice ? (
        <p className="editor__notice" role="alert">
          {session.notice}
        </p>
      ) : null}
      <WorksheetTabs
        worksheets={workbook.worksheets}
        activeId={activeWorksheet.id}
        busy={session.busy}
        onSelect={(worksheetId) => {
          setFilterColumn(null);
          setValidationTarget(null);
          setPivotSourceRange(null);
          setSortTarget(null);
          void session.selectWorksheet(worksheetId);
        }}
        onAdd={() => {
          void session.addWorksheet();
        }}
        onRename={(worksheet) => setRenameWorksheetTarget(worksheet)}
        onDelete={(worksheet) => {
          // The workbook always keeps one worksheet: the guard needs no confirmation dialog.
          if (workbook.worksheets.length <= 1) {
            session.showNotice(LAST_WORKSHEET_MESSAGE);
            return;
          }
          setDeleteWorksheetTarget(worksheet);
        }}
        panel={
          <>
            {pivot ? (
              <PivotTableEditor
                key={`pivot-${activeWorksheet.id}`}
                pivot={pivot}
                sourceWorksheet={pivotSource}
                busy={session.busy}
                onApply={(fields) => session.applyPivotFields(fields)}
                onRefresh={() => session.refreshPivotTable()}
              />
            ) : null}
            <WorksheetGrid
              key={`grid-${activeWorksheet.id}`}
              worksheet={activeWorksheet}
              selection={session.selection}
              onSelectionChange={session.selectCells}
              busy={session.busy}
              hasRangeClipboard={session.rangeClipboard !== null}
              onCopyRange={session.copyRange}
              onCutRange={session.cutRange}
              onPasteRange={(text, start) => {
                void session.pasteText(text, start);
              }}
              onFilterColumn={(column) => setFilterColumn(column)}
              onSelectDropdownValue={(cellId, value) => {
                void session.writeCellValue(cellId, value);
              }}
              onStructureCommand={(axis, command, index) => {
                // A shifted structure can move the column or range a dialog was opened on.
                setFilterColumn(null);
                setValidationTarget(null);
                setPivotSourceRange(null);
                setSortTarget(null);
                void session.changeStructure(structureChangeOf(axis, command, index));
              }}
              editing={{
                cellId: session.inlineCellId,
                text: session.inlineText,
                onStart: session.startEdit,
                onChange: session.changeEdit,
                onCommit: () => {
                  void session.commitEdit();
                },
                onCancel: session.cancelEdit,
              }}
            />
          </>
        }
      />
      {filter && openFilterColumn !== null ? (
        <FilterDialog
          open
          headerText={filterHeaderText(activeWorksheet, filter, openFilterColumn)}
          column={openFilterColumn}
          region={filter.region}
          worksheet={activeWorksheet}
          columnFilter={columnFilterOf(filter, openFilterColumn)}
          onOpenChange={(open) => {
            if (!open) setFilterColumn(null);
          }}
          onApply={async (next) => {
            await session.saveColumnFilter(withColumnFilter(filter, next));
            setFilterColumn(null);
          }}
        />
      ) : null}
      <DataValidationDialog
        open={validationTarget !== null}
        range={validationTarget ?? SINGLE_CELL_REGION}
        existingRule={existingRule}
        onOpenChange={(open) => {
          if (!open) setValidationTarget(null);
        }}
        onSave={async (payload) => {
          await session.saveValidationRule(payload);
          setValidationTarget(null);
        }}
        onDelete={async () => {
          if (existingRule) await session.deleteValidationRule(existingRule.id);
          setValidationTarget(null);
        }}
      />
      {sortTarget ? (
        <SortRangeDialog
          open
          range={sortTarget}
          worksheet={activeWorksheet}
          onOpenChange={(open) => {
            if (!open) setSortTarget(null);
          }}
          onSort={async (payload) => {
            await session.sortRange(payload);
            setSortTarget(null);
          }}
        />
      ) : null}
      <CreatePivotTableDialog
        open={pivotSourceRange !== null}
        sourceRange={pivotSourceRange ?? SINGLE_CELL_REGION}
        onOpenChange={(open) => {
          if (!open) setPivotSourceRange(null);
        }}
        onCreate={async () => {
          const region = pivotSourceRange;
          if (!region) return;
          await session.createPivotTable(region);
          setPivotSourceRange(null);
        }}
      />
      <RenameWorkbookDialog
        workbookId={workbook.id}
        open={renameOpen}
        currentName={workbook.name}
        onOpenChange={setRenameOpen}
        onSaved={session.replaceWorkbook}
      />
      <RenameWorksheetDialog
        workbookId={workbook.id}
        worksheetId={renameWorksheetTarget?.id ?? ""}
        open={renameWorksheetTarget !== null}
        currentName={renameWorksheetTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenameWorksheetTarget(null);
        }}
        onSaved={(updated) => {
          session.replaceWorkbook(updated);
          setRenameWorksheetTarget(null);
        }}
      />
      <DeleteWorksheetDialog
        open={deleteWorksheetTarget !== null}
        worksheetName={deleteWorksheetTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setDeleteWorksheetTarget(null);
        }}
        onDelete={async () => {
          const target = deleteWorksheetTarget;
          if (!target) return;
          await session.deleteWorksheet(target.id);
        }}
        onDeleted={() => setDeleteWorksheetTarget(null)}
        onRefused={(message) => {
          // A pivot table still reads the worksheet: nothing changed, only the reason is shown.
          setDeleteWorksheetTarget(null);
          session.showNotice(message);
        }}
      />
    </main>
  );
}
