import { useId, type KeyboardEvent, type ReactNode } from "react";

import type { Worksheet } from "../domain/types";
import { Button, Menu } from "../ui";

export interface WorksheetTabBarProps {
  sheets: readonly Worksheet[];
  activeId: string;
  onChange(sheetId: string): void;
  onAdd(): void;
  onRename(sheet: Worksheet): void;
  onDelete(sheet: Worksheet): void;
  renderPanel(sheet: Worksheet): ReactNode;
}

export function WorksheetTabBar({ sheets, activeId, onChange, onAdd, onRename, onDelete, renderPanel }: WorksheetTabBarProps) {
  const prefix = useId();
  const active = sheets.find((sheet) => sheet.id === activeId) ?? sheets[0];

  const move = (from: number, direction: 1 | -1 | "home" | "end") => {
    let index: number;
    if (direction === "home") index = 0;
    else if (direction === "end") index = sheets.length - 1;
    else index = (from + direction + sheets.length) % sheets.length;
    const sheet = sheets[index];
    if (!sheet) return;
    onChange(sheet.id);
    queueMicrotask(() => document.getElementById(`${prefix}-tab-${sheet.id}`)?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(index, event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(index, "home");
    } else if (event.key === "End") {
      event.preventDefault();
      move(index, "end");
    }
  };

  return (
    <div className="worksheet-tabs">
      <div className="worksheet-tabs__bar">
        <div role="tablist" aria-label="Worksheets" className="worksheet-tabs__list">
          {sheets.map((sheet, index) => {
            const selected = sheet.id === active?.id;
            return (
              <div key={sheet.id} className="worksheet-tab">
                <button
                  id={`${prefix}-tab-${sheet.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${prefix}-panel-${sheet.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onChange(sheet.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  {sheet.name}
                </button>
                <Menu
                  triggerLabel="⋯"
                  triggerAriaLabel={`Worksheet options for ${sheet.name}`}
                  buttonVariant="ghost"
                  menuLabel={`Worksheet options for ${sheet.name}`}
                  items={[
                    {
                      id: "rename",
                      label: "Rename",
                      onSelect: () => onRename(sheet),
                    },
                    {
                      id: "delete",
                      label: "Delete",
                      tone: "danger",
                      onSelect: () => onDelete(sheet),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
        <Button variant="ghost" className="worksheet-tabs__add" aria-label="Add worksheet" onClick={onAdd}>
          +
        </Button>
      </div>
      {active ? (
        <div
          id={`${prefix}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${prefix}-tab-${active.id}`}
          className="worksheet-tabs__panel"
        >
          {renderPanel(active)}
        </div>
      ) : null}
    </div>
  );
}
