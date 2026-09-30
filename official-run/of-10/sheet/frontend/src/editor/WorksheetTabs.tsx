import { useId, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { Button, Menu } from "../ui";
import type { WorksheetData } from "../workbooks/types";
export interface WorksheetTabsProps {
  /** Worksheets in their stored order; the tab bar shows this order and the active state. */
  worksheets: readonly WorksheetData[];
  activeId: string;
  /** Panel of the active worksheet (the grid). */
  panel: ReactNode;
  /** True while a worksheet mutation is running, so the bar cannot start a second one. */
  busy?: boolean;
  onSelect(worksheetId: string): void;
  onAdd(): void;
  /** Opens the rename dialog of one worksheet from its options menu. */
  onRename(worksheet: WorksheetData): void;
  /**
   * Runs the `Delete` command of one worksheet tab menu: it opens the confirmation dialog, or
   * reports that the workbook must keep at least one worksheet.
   */
  onDelete(worksheet: WorksheetData): void;
}

/**
 * The worksheet tab bar of the editor: one tab per worksheet with its own options menu, the
 * `Add worksheet` button and the panel of the active worksheet.
 */
export function WorksheetTabs({
  worksheets,
  activeId,
  panel,
  busy = false,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: WorksheetTabsProps) {
  const prefix = useId();
  const active = worksheets.find((worksheet) => worksheet.id === activeId) ?? worksheets[0] ?? null;

  const move = (from: number, direction: 1 | -1) => {
    if (worksheets.length === 0) return;
    const index = (from + direction + worksheets.length) % worksheets.length;
    onSelect(worksheets[index].id);
    queueMicrotask(() => document.getElementById(`${prefix}-tab-${worksheets[index].id}`)?.focus());
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(index, event.key === "ArrowRight" ? 1 : -1);
    }
  };

  return (
    <div className="ui-tabs worksheet-tabs">
      <div className="worksheet-tabs__bar">
        <div role="tablist" aria-label="Worksheets" className="worksheet-tabs__list">
          {worksheets.map((worksheet, index) => {
            const selected = active?.id === worksheet.id;
            return (
              <div key={worksheet.id} role="presentation" className="worksheet-tabs__tab">
                <button
                  id={`${prefix}-tab-${worksheet.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${prefix}-panel-${worksheet.id}`}
                  tabIndex={selected ? 0 : -1}
                  className="worksheet-tabs__tab-button"
                  onClick={() => onSelect(worksheet.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {worksheet.name}
                </button>
                <Menu
                  triggerLabel={`Worksheet options for ${worksheet.name}`}
                  triggerContent="▾"
                  menuLabel={`Options for ${worksheet.name}`}
                  buttonVariant="ghost"
                  items={[
                    {
                      id: "rename",
                      label: "Rename",
                      onSelect: () => onRename(worksheet),
                    },
                    {
                      id: "delete",
                      label: "Delete",
                      tone: "danger",
                      onSelect: () => onDelete(worksheet),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
        <Button onClick={onAdd} disabled={busy}>
          Add worksheet
        </Button>
      </div>
      {active ? (
        <div
          id={`${prefix}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-${active.id}`}
          className="ui-tabs__panel"
        >
          {panel}
        </div>
      ) : null}
    </div>
  );
}
