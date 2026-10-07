import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import { freezeLabel, freezeMenuItems, type FreezeCommand } from "../domain/freeze";
import type { WorksheetFreeze } from "../domain/types";

export interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onExportCsv(): void;
  /** Open the "Find and replace" dialog of the Edit menu. */
  onFindReplace(): void;
  /** Open the note dialog of the selected cell (the Insert menu's "Add note"). */
  onAddNote(): void;
  /** Top-left cell of the current selection, naming the freeze commands. */
  selectionStart: string;
  freeze?: WorksheetFreeze | null;
  onFreezeCommand(command: FreezeCommand): void;
  onClearFreeze(): void;
  onCreateFilter(): void;
  onClearFilter(): void;
  onSaveFilterView(): void;
  onFilterViews(): void;
  onSortRange(): void;
  onDataValidation(): void;
  onNamedRanges(): void;
  onCreatePivot(): void;
  onConditionalFormatting(): void;
}

/**
 * Command bar of the workbook editor: the clipboard and export buttons, the
 * frozen-pane command of the View menu and the Edit, Insert, View, Data and
 * Format menus. Every command is a callback of the page, so the bar only
 * decides where a command is offered; the menu labels are the accessible names
 * the page and its tests address.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onExportCsv,
  onFindReplace,
  onAddNote,
  selectionStart,
  freeze,
  onFreezeCommand,
  onClearFreeze,
  onCreateFilter,
  onClearFilter,
  onSaveFilterView,
  onFilterViews,
  onSortRange,
  onDataValidation,
  onNamedRanges,
  onCreatePivot,
  onConditionalFormatting,
}: EditorToolbarProps) {
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
      <Menu triggerLabel="Insert" items={[{ id: "add-note", label: "Add note", onSelect: onAddNote }]} />
      <Menu
        triggerLabel="View"
        items={freezeMenuItems(selectionStart).map((item) => ({
          id: item.id,
          label: item.label,
          onSelect: () => onFreezeCommand(item.id),
        }))}
      />
      <Button onClick={onClearFreeze}>{freezeLabel(freeze)}</Button>
      <Menu
        triggerLabel="Data"
        items={[
          { id: "create-filter", label: "Create filter", onSelect: onCreateFilter },
          { id: "clear-filter", label: "Clear filter", onSelect: onClearFilter },
          { id: "save-filter-view", label: "Save filter view", onSelect: onSaveFilterView },
          { id: "filter-views", label: "Filter views", onSelect: onFilterViews },
          { id: "sort-range", label: "Sort range", onSelect: onSortRange },
          { id: "data-validation", label: "Data validation", onSelect: onDataValidation },
          { id: "named-ranges", label: "Named ranges", onSelect: onNamedRanges },
          { id: "create-pivot", label: "Create pivot table", onSelect: onCreatePivot },
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
