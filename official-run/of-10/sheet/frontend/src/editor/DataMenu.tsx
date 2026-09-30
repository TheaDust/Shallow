import { Menu } from "../ui";

export interface DataMenuProps {
  /** Creates a filter view over the data region of the current selection. */
  onCreateFilter(): void;
  /** Opens the `Sort range` dialog for the selected range (REQ-5-1-1). */
  onSortRange(): void;
  /** Opens the `Create pivot table` dialog for the selected source range (REQ-5-3-1). */
  onCreatePivotTable(): void;
  /** Removes the filter view of the active worksheet. */
  onClearFilter(): void;
  /** Opens the `Data validation` dialog for the selected target range. */
  onDataValidation(): void;
}

/**
 * `Data` command menu of the editor toolbar. Each command is a menu item, so the menu exposes the
 * `menuitem` role required for the data organization commands.
 */
export function DataMenu({
  onCreateFilter,
  onSortRange,
  onCreatePivotTable,
  onClearFilter,
  onDataValidation,
}: DataMenuProps) {
  return (
    <Menu
      triggerLabel="Data"
      menuLabel="Data"
      items={[
        { id: "create-filter", label: "Create filter", onSelect: onCreateFilter },
        { id: "sort-range", label: "Sort range", onSelect: onSortRange },
        { id: "create-pivot-table", label: "Create pivot table", onSelect: onCreatePivotTable },
        { id: "clear-filter", label: "Clear filter", onSelect: onClearFilter },
        { id: "data-validation", label: "Data validation", onSelect: onDataValidation },
      ]}
    />
  );
}
