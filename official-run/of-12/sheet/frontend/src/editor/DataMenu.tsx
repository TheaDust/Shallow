import { Menu } from "../ui";

export interface DataMenuProps {
  /** Commands are unavailable while another operation is in flight. */
  disabled?: boolean;
  onSortRange(): void;
  onCreateFilter(): void;
  onClearFilter(): void;
  onDataValidation(): void;
  onCreatePivotTable(): void;
}

/**
 * `Data` toolbar menu (REQ-5). Its commands are ordinary `menuitem`s: they sort the selected data
 * range, open a data range's filter view, remove it again, open the data-validation dialog for the
 * selected range, or create a pivot table for it.
 */
export function DataMenu({
  disabled,
  onSortRange,
  onCreateFilter,
  onClearFilter,
  onDataValidation,
  onCreatePivotTable,
}: DataMenuProps) {
  return (
    <Menu
      triggerLabel="Data"
      menuLabel="Data"
      items={[
        { id: "sort-range", label: "Sort range", disabled, onSelect: onSortRange },
        { id: "create-filter", label: "Create filter", disabled, onSelect: onCreateFilter },
        { id: "clear-filter", label: "Clear filter", disabled, onSelect: onClearFilter },
        { id: "data-validation", label: "Data validation", disabled, onSelect: onDataValidation },
        { id: "create-pivot-table", label: "Create pivot table", disabled, onSelect: onCreatePivotTable },
      ]}
    />
  );
}
