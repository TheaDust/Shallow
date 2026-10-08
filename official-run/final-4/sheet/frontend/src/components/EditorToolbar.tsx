import { Menu } from "../ui/Menu";
import { Button } from "../ui/Button";

/**
 * Command bar of the workbook editor. It is a pure view fragment: every entry
 * only reports the requested command, so the editor keeps the state and the API
 * calls. The Edit, View, Data and Format menus stay separate controls with their
 * own accessible names, and each command keeps the name its requirement fixes.
 */
export interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onExportCsv(): void;
  /** Current frozen-pane counts, shown by the state button. */
  frozenRows: number;
  frozenColumns: number;
  /** Command labels of the "View" menu, which follow the selected cell. */
  freezeRowsCommand: string;
  freezeColumnsCommand: string;
  freezePanesCommand: string;
  onFreezeRows(): void;
  onFreezeColumns(): void;
  onFreezePanes(): void;
  onFindReplace(): void;
  onAddNote(): void;
  onNamedRanges(): void;
  onConditionalFormatting(): void;
  onCreateFilter(): void;
  onClearFilter(): void;
  onSaveFilterView(): void;
  onFilterViews(): void;
  onSortRange(): void;
  onDataValidation(): void;
  onCreatePivot(): void;
}

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onExportCsv,
  frozenRows,
  frozenColumns,
  freezeRowsCommand,
  freezeColumnsCommand,
  freezePanesCommand,
  onFreezeRows,
  onFreezeColumns,
  onFreezePanes,
  onFindReplace,
  onAddNote,
  onNamedRanges,
  onConditionalFormatting,
  onCreateFilter,
  onClearFilter,
  onSaveFilterView,
  onFilterViews,
  onSortRange,
  onDataValidation,
  onCreatePivot,
}: EditorToolbarProps) {
  const freezeState = `Frozen rows: ${frozenRows}; columns: ${frozenColumns}`;
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
      <Button onClick={onExportCsv}>Export CSV</Button>
      <Menu
        triggerLabel="Edit"
        items={[{ id: "find-replace", label: "Find and replace", onSelect: onFindReplace }]}
      />
      <Menu
        triggerLabel="Insert"
        items={[{ id: "add-note", label: "Add note", onSelect: onAddNote }]}
      />
      <Menu
        triggerLabel="View"
        items={[
          { id: "freeze-rows", label: freezeRowsCommand, onSelect: onFreezeRows },
          { id: "freeze-columns", label: freezeColumnsCommand, onSelect: onFreezeColumns },
          { id: "freeze-panes", label: freezePanesCommand, onSelect: onFreezePanes },
        ]}
      />
      <Button aria-label={freezeState}>{freezeState}</Button>
      <Menu
        triggerLabel="Data"
        items={[
          { id: "create-filter", label: "Create filter", onSelect: onCreateFilter },
          { id: "clear-filter", label: "Clear filter", onSelect: onClearFilter },
          { id: "save-filter-view", label: "Save filter view", onSelect: onSaveFilterView },
          { id: "filter-views", label: "Filter views", onSelect: onFilterViews },
          { id: "sort-range", label: "Sort range", onSelect: onSortRange },
          { id: "data-validation", label: "Data validation", onSelect: onDataValidation },
          { id: "create-pivot", label: "Create pivot table", onSelect: onCreatePivot },
          { id: "named-ranges", label: "Named ranges", onSelect: onNamedRanges },
        ]}
      />
      <Menu
        triggerLabel="Format"
        items={[
          { id: "conditional-formatting", label: "Conditional formatting", onSelect: onConditionalFormatting },
        ]}
      />
    </div>
  );
}
