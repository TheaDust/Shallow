import { Menu, type MenuItem } from "../ui/Menu";

export interface DataMenuProps {
  /** True while another command is in flight: the menu stays visible but its commands are disabled. */
  busy?: boolean;
  onSortRange(): void;
  onCreateFilter(): void;
  onClearFilter(): void;
  onDataValidation(): void;
  onCreatePivotTable(): void;
}

/**
 * `Data` command menu of the editor toolbar (REQ-5): the data-organization commands of the
 * current active worksheet. Commands keep their DOM node and become `disabled` while a request
 * is in flight, so the menu never changes shape mid-operation.
 */
export function DataMenu({
  busy = false,
  onSortRange,
  onCreateFilter,
  onClearFilter,
  onDataValidation,
  onCreatePivotTable,
}: DataMenuProps) {
  const items: MenuItem[] = [
    { id: "sort-range", label: "Sort range", disabled: busy, onSelect: onSortRange },
    { id: "create-filter", label: "Create filter", disabled: busy, onSelect: onCreateFilter },
    { id: "clear-filter", label: "Clear filter", disabled: busy, onSelect: onClearFilter },
    { id: "data-validation", label: "Data validation", disabled: busy, onSelect: onDataValidation },
    {
      id: "create-pivot-table",
      label: "Create pivot table",
      disabled: busy,
      onSelect: onCreatePivotTable,
    },
  ];
  return <Menu triggerLabel="Data" menuLabel="Data" items={items} />;
}
