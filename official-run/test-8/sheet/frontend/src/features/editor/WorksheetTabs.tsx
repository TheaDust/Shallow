import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";
import type { Worksheet } from "../../domain/types";

export interface WorksheetTabsProps {
  worksheets: readonly Worksheet[];
  activeId: string;
  /** Disables the "Add worksheet" button while a creation request is in flight. */
  addBusy?: boolean;
  onSelect(id: string): void;
  onAddWorksheet(): void;
  onRenameWorksheet(id: string): void;
  onDeleteWorksheet(id: string): void;
}

/**
 * Tab bar of the workbook editor: worksheet tabs in workbook order, a
 * "Worksheet options for <name>" menu per tab (the `Rename` and `Delete`
 * commands) and the "Add worksheet" button.
 */
export function WorksheetTabs({
  worksheets,
  activeId,
  addBusy = false,
  onSelect,
  onAddWorksheet,
  onRenameWorksheet,
  onDeleteWorksheet,
}: WorksheetTabsProps) {
  return (
    <div className="worksheet-tabbar">
      <div role="tablist" aria-label="Worksheets" className="worksheet-tabs">
        {worksheets.map((worksheet) => {
          const selected = worksheet.id === activeId;
          return (
            <div key={worksheet.id} role="presentation" className="worksheet-tabs__item">
              <button
                id={`worksheet-tab-${worksheet.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`worksheet-panel-${worksheet.id}`}
                tabIndex={selected ? 0 : -1}
                className="worksheet-tabs__tab"
                onClick={() => onSelect(worksheet.id)}
              >
                {worksheet.name}
              </button>
              <Menu
                triggerLabel={`Worksheet options for ${worksheet.name}`}
                menuLabel={`Worksheet options for ${worksheet.name}`}
                buttonVariant="ghost"
                items={[
                  {
                    id: "rename",
                    label: "Rename",
                    onSelect: () => onRenameWorksheet(worksheet.id),
                  },
                  {
                    id: "delete",
                    label: "Delete",
                    tone: "danger",
                    onSelect: () => onDeleteWorksheet(worksheet.id),
                  },
                ]}
              />
            </div>
          );
        })}
      </div>
      <Button
        className="worksheet-tabbar__add"
        disabled={addBusy}
        onClick={onAddWorksheet}
      >
        Add worksheet
      </Button>
    </div>
  );
}
