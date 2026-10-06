import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { cellName, columnName, type CellPosition } from "../domain/grid";
import type { WorksheetFreeze } from "../domain/types";

export interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  /** Active cell of the worksheet, used by the wording of the "View" menu. */
  anchor: CellPosition;
  /** Frozen panes of the active worksheet, reported by the frozen-panes button. */
  frozen: WorksheetFreeze;
  onUndo(): void;
  onRedo(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onExport(): void;
  onFindReplace(): void;
  /** Open the note interface of the active cell (the "Insert" menu). */
  onAddNote(): void;
  onFreeze(rows: number, columns: number): void;
  onCreateFilter(): void;
  onClearFilter(): void;
  onSaveFilterView(): void;
  onFilterViews(): void;
  onSortRange(): void;
  onDataValidation(): void;
  onCreatePivot(): void;
  onNamedRanges(): void;
  onConditionalFormatting(): void;
}

/**
 * Command bar of the workbook editor: the clipboard and history commands, the
 * "Export CSV" command, the `Edit`/`Insert`/`View`/`Data`/`Format` menus and the
 * button reporting the frozen panes. It only dispatches to the editor's
 * handlers, so every command keeps the accessible name it has always had.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  anchor,
  frozen,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onExport,
  onFindReplace,
  onAddNote,
  onFreeze,
  onCreateFilter,
  onClearFilter,
  onSaveFilterView,
  onFilterViews,
  onSortRange,
  onDataValidation,
  onCreatePivot,
  onNamedRanges,
  onConditionalFormatting,
}: EditorToolbarProps) {
  const viewItems: MenuItem[] = [
    {
      id: "freeze-rows",
      label: `Freeze rows through ${anchor.row}`,
      onSelect: () => onFreeze(anchor.row, frozen.columns),
    },
    {
      id: "freeze-columns",
      label: `Freeze columns through ${columnName(anchor.column)}`,
      onSelect: () => onFreeze(frozen.rows, anchor.column),
    },
    {
      id: "freeze-panes",
      label: `Freeze panes at ${cellName(anchor.row, anchor.column)}`,
      onSelect: () => onFreeze(anchor.row - 1, anchor.column - 1),
    },
  ];
  const dataItems: MenuItem[] = [
    { id: "create-filter", label: "Create filter", onSelect: onCreateFilter },
    { id: "clear-filter", label: "Clear filter", onSelect: onClearFilter },
    { id: "save-filter-view", label: "Save filter view", onSelect: onSaveFilterView },
    { id: "filter-views", label: "Filter views", onSelect: onFilterViews },
    { id: "sort-range", label: "Sort range", onSelect: onSortRange },
    { id: "data-validation", label: "Data validation", onSelect: onDataValidation },
    { id: "create-pivot", label: "Create pivot table", onSelect: onCreatePivot },
    { id: "named-ranges", label: "Named ranges", onSelect: onNamedRanges },
  ];
  const formatItems: MenuItem[] = [
    { id: "conditional-formatting", label: "Conditional formatting", onSelect: onConditionalFormatting },
  ];
  const insertItems: MenuItem[] = [{ id: "add-note", label: "Add note", onSelect: onAddNote }];

  return (
    <div className="editor-toolbar">
      <Button onClick={onUndo} disabled={!canUndo}>
        Undo
      </Button>
      <Button onClick={onRedo} disabled={!canRedo}>
        Redo
      </Button>
      <Button onClick={onCopy}>Copy</Button>
      <Button onClick={onCut}>Cut</Button>
      <Button onClick={onPaste}>Paste</Button>
      <Button onClick={onExport}>Export CSV</Button>
      <Menu
        triggerLabel="Edit"
        items={[{ id: "find-replace", label: "Find and replace", onSelect: onFindReplace }]}
      />
      <Menu triggerLabel="Insert" items={insertItems} />
      <Menu triggerLabel="View" items={viewItems} />
      <Menu triggerLabel="Data" items={dataItems} />
      <Menu triggerLabel="Format" items={formatItems} />
      <Button>{`Frozen rows: ${frozen.rows}; columns: ${frozen.columns}`}</Button>
    </div>
  );
}
