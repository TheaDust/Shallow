import { useId, type ReactNode } from "react";

import type { Worksheet } from "../lib/workbooks";
import { Button, Menu } from "../ui";

export interface WorksheetTabsProps {
  /** Worksheets in tab order; the order of this array is the workbook's worksheet order. */
  worksheets: readonly Worksheet[];
  activeId: string;
  /** While an operation is in flight every command stays available but refuses a second run. */
  busy?: boolean;
  /** ARIA tab activation: the clicked tab becomes the active worksheet. */
  onSelect(worksheetId: string): void;
  /** The `Add worksheet` button of the tab bar. */
  onAdd(): void;
  /** The `Rename` command of one worksheet's options menu. */
  onRename(worksheet: Worksheet): void;
  /** The `Delete` command of one worksheet's options menu. */
  onDelete(worksheet: Worksheet): void;
  /** The grid (and its toolbar entry points) of the active worksheet. */
  panel: ReactNode;
}

/**
 * Worksheet tab bar (REQ-2-1): one ARIA tab per worksheet in workbook order with the active state,
 * a `Worksheet options for <worksheet name>` button opening a menu of `menuitem` commands, and the
 * `Add worksheet` button. Only the active worksheet's panel is rendered, so the grid always belongs
 * to the active worksheet only.
 */
export function WorksheetTabs({
  worksheets,
  activeId,
  busy = false,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  panel,
}: WorksheetTabsProps) {
  const prefix = useId();
  const active = worksheets.find((worksheet) => worksheet.id === activeId) ?? worksheets[0];
  const tabId = (worksheetId: string) => `${prefix}-tab-${worksheetId}`;
  const panelId = (worksheetId: string) => `${prefix}-panel-${worksheetId}`;

  const focusTab = (worksheet: Worksheet) => {
    onSelect(worksheet.id);
    queueMicrotask(() => document.getElementById(tabId(worksheet.id))?.focus());
  };

  const move = (from: number, direction: 1 | -1) => {
    if (worksheets.length < 2) return;
    const index = (from + direction + worksheets.length) % worksheets.length;
    focusTab(worksheets[index]);
  };

  return (
    <div className="worksheet-tabs">
      <div className="worksheet-tabs__bar">
        <div role="tablist" aria-label="Worksheets" className="worksheet-tabs__list">
          {worksheets.map((worksheet, index) => (
            <div key={worksheet.id} role="presentation" className="worksheet-tab">
              <button
                id={tabId(worksheet.id)}
                type="button"
                role="tab"
                className="worksheet-tab__button"
                aria-selected={worksheet.id === active?.id}
                aria-controls={panelId(worksheet.id)}
                tabIndex={worksheet.id === active?.id ? 0 : -1}
                onClick={() => onSelect(worksheet.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    move(index, event.key === "ArrowRight" ? 1 : -1);
                  }
                }}
              >
                {worksheet.name}
              </button>
              <Menu
                triggerLabel={`Worksheet options for ${worksheet.name}`}
                triggerContent={<span aria-hidden="true" className="worksheet-tab__caret" />}
                menuLabel={`Worksheet options for ${worksheet.name}`}
                buttonVariant="ghost"
                items={[
                  { id: "rename", label: "Rename", disabled: busy, onSelect: () => onRename(worksheet) },
                  {
                    id: "delete",
                    label: "Delete",
                    tone: "danger",
                    disabled: busy,
                    onSelect: () => onDelete(worksheet),
                  },
                ]}
              />
            </div>
          ))}
        </div>
        <Button className="worksheet-tabs__add" onClick={onAdd} disabled={busy}>
          Add worksheet
        </Button>
      </div>
      {active ? (
        <div
          id={panelId(active.id)}
          role="tabpanel"
          aria-labelledby={tabId(active.id)}
          className="worksheet-tabs__panel"
        >
          {panel}
        </div>
      ) : null}
    </div>
  );
}
