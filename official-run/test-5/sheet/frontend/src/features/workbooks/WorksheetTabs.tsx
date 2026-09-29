import { useId, type KeyboardEvent, type ReactNode } from "react";

import { Button, Menu } from "../../ui";

export interface WorksheetTab {
  id: string;
  name: string;
}

export const ADD_WORKSHEET_LABEL = "Add worksheet";
export const RENAME_WORKSHEET_COMMAND = "Rename";

/** Accessible name of the per-worksheet options button. */
export function worksheetOptionsLabel(worksheetName: string): string {
  return `Worksheet options for ${worksheetName}`;
}

export interface WorksheetTabsProps {
  worksheets: readonly WorksheetTab[];
  activeId: string;
  onChange(worksheetId: string): void;
  onAdd(): void;
  onRename(worksheetId: string): void;
  addDisabled?: boolean;
  children: ReactNode;
}

export function WorksheetTabs({
  worksheets,
  activeId,
  onChange,
  onAdd,
  onRename,
  addDisabled = false,
  children,
}: WorksheetTabsProps) {
  const prefix = useId();
  const panelId = `${prefix}-worksheet-panel`;

  const move = (index: number, direction: 1 | -1) => {
    const next = (index + direction + worksheets.length) % worksheets.length;
    const target = worksheets[next];
    if (!target) return;
    onChange(target.id);
    queueMicrotask(() => document.getElementById(`${prefix}-tab-${target.id}`)?.focus());
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    move(index, event.key === "ArrowRight" ? 1 : -1);
  };

  return (
    <div className="worksheet-tabs">
      <div className="worksheet-tabs__bar">
        <div role="tablist" aria-label="Worksheets" className="worksheet-tabs__list">
          {worksheets.map((worksheet, index) => (
            <div key={worksheet.id} role="presentation" className="worksheet-tabs__item">
              <button
                id={`${prefix}-tab-${worksheet.id}`}
                type="button"
                role="tab"
                aria-selected={worksheet.id === activeId}
                aria-controls={panelId}
                tabIndex={worksheet.id === activeId ? 0 : -1}
                className="worksheet-tabs__tab"
                onClick={() => onChange(worksheet.id)}
                onKeyDown={handleKeyDown(index)}
              >
                {worksheet.name}
              </button>
              <Menu
                triggerLabel="▾"
                triggerAriaLabel={worksheetOptionsLabel(worksheet.name)}
                menuLabel={worksheetOptionsLabel(worksheet.name)}
                buttonVariant="ghost"
                items={[
                  {
                    id: "rename",
                    label: RENAME_WORKSHEET_COMMAND,
                    onSelect: () => onRename(worksheet.id),
                  },
                ]}
              />
            </div>
          ))}
        </div>
        <Button className="worksheet-tabs__add" onClick={onAdd} disabled={addDisabled}>
          {ADD_WORKSHEET_LABEL}
        </Button>
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={`${prefix}-tab-${activeId}`} className="worksheet-tabs__panel">
        {children}
      </div>
    </div>
  );
}
