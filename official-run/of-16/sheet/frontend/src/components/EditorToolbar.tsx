import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";

export interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onExport(): void;
  /** Filter view of the active worksheet; `Clear filter` is disabled without one. */
  hasFilter: boolean;
  onCreateFilter(): void;
  onSortRange(): void;
  onCreatePivot(): void;
  onDataValidation(): void;
  onClearFilter(): void;
}

/**
 * Workbook toolbar of the editor. The `Data` menu groups the organization
 * commands of the current worksheet (REQ-5); its commands are `menuitem`s.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onExport,
  hasFilter,
  onCreateFilter,
  onSortRange,
  onCreatePivot,
  onDataValidation,
  onClearFilter,
}: EditorToolbarProps) {
  return (
    <div className="editor__toolbar" role="toolbar" aria-label="Workbook toolbar">
      <Button onClick={onUndo} disabled={!canUndo}>Undo</Button>
      <Button onClick={onRedo} disabled={!canRedo}>Redo</Button>
      <Button onClick={onCopy}>Copy</Button>
      <Button onClick={onCut}>Cut</Button>
      <Button onClick={onPaste}>Paste</Button>
      <Button onClick={onExport}>Export CSV</Button>
      <Menu
        triggerLabel="Data"
        menuLabel="Data"
        items={[
          { id: "create-filter", label: "Create filter", onSelect: onCreateFilter },
          { id: "sort-range", label: "Sort range", onSelect: onSortRange },
          { id: "create-pivot", label: "Create pivot table", onSelect: onCreatePivot },
          { id: "data-validation", label: "Data validation", onSelect: onDataValidation },
          { id: "clear-filter", label: "Clear filter", disabled: !hasFilter, onSelect: onClearFilter },
        ]}
      />
    </div>
  );
}
