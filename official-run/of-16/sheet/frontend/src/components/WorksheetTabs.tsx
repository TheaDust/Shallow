import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { Worksheet } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";

export interface WorksheetTabsProps {
  worksheets: readonly Worksheet[];
  activeId: string;
  panelId: string;
  onSelect(id: string): void;
  /** Opens the "Rename worksheet" dialog for the worksheet behind the menu. */
  onRename(id: string): void;
  /** Opens the "Delete worksheet" confirmation for the worksheet behind the menu. */
  onDelete(id: string): void;
  onAdd(): void;
  /** True while a worksheet is being added; keeps the tab bar from repeating it. */
  adding?: boolean;
}

/**
 * Worksheet tab bar: `role="tab"` per worksheet (in workbook order, exposing the
 * active state), a per-tab options menu button `Worksheet options for <name>`
 * whose commands are `menuitem`s (`Rename`, `Delete`), and the `Add worksheet`
 * button.
 */
export function WorksheetTabs({
  worksheets,
  activeId,
  panelId,
  onSelect,
  onRename,
  onDelete,
  onAdd,
  adding = false,
}: WorksheetTabsProps) {
  const tabNodes = useRef(new Map<string, HTMLButtonElement>());

  const focusTab = (id: string) => {
    onSelect(id);
    tabNodes.current.get(id)?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + offset + worksheets.length) % worksheets.length;
    focusTab(worksheets[next].id);
  };

  return (
    <div className="worksheet-tabbar">
      <div role="tablist" aria-label="Worksheets" className="worksheet-tabs">
        {worksheets.map((worksheet, index) => (
          <div key={worksheet.id} className="worksheet-tabs__slot" data-worksheet-slot={worksheet.id}>
            <button
              ref={(node) => {
                if (node) tabNodes.current.set(worksheet.id, node);
                else tabNodes.current.delete(worksheet.id);
              }}
              type="button"
              role="tab"
              id={tabId(worksheet.id)}
              aria-selected={worksheet.id === activeId}
              aria-controls={panelId}
              tabIndex={worksheet.id === activeId ? 0 : -1}
              className="worksheet-tabs__tab"
              data-worksheet={worksheet.name}
              onClick={() => onSelect(worksheet.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
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
                  onSelect: () => onRename(worksheet.id),
                },
                {
                  id: "delete",
                  label: "Delete",
                  tone: "danger",
                  onSelect: () => onDelete(worksheet.id),
                },
              ]}
            />
          </div>
        ))}
      </div>
      <Button
        className="worksheet-tabbar__add"
        disabled={adding}
        onClick={onAdd}
      >
        Add worksheet
      </Button>
    </div>
  );
}

export function tabId(worksheetId: string): string {
  return `worksheet-tab-${worksheetId}`;
}
