import { useRef, type KeyboardEvent } from "react";

import type { WorksheetState } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";

export interface WorksheetTabsProps {
  sheets: readonly WorksheetState[];
  activeSheetId: string;
  onSelect(sheetId: string): void;
  onAddWorksheet(): void;
  onRenameWorksheet(sheet: WorksheetState): void;
  onDeleteWorksheet(sheet: WorksheetState): void;
  /** True while a worksheet is being added: the same button stays visible but disabled. */
  adding?: boolean;
}

/**
 * Worksheet tab bar: one ARIA tab per worksheet plus a per-tab options menu
 * (`Worksheet options for <worksheet name>`) and the `Add worksheet` button.
 */
export function WorksheetTabs({
  sheets,
  activeSheetId,
  onSelect,
  onAddWorksheet,
  onRenameWorksheet,
  onDeleteWorksheet,
  adding = false,
}: WorksheetTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusTab(index: number) {
    queueMicrotask(() => tabRefs.current[index]?.focus());
  }

  function move(target: number) {
    const next = sheets[target];
    if (!next) return;
    onSelect(next.id);
    focusTab(target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move((index + 1) % sheets.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move((index - 1 + sheets.length) % sheets.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(sheets.length - 1);
    }
  }

  return (
    <div role="tablist" aria-label="Worksheets" className="ui-tabs__list worksheet-tab-bar">
      {sheets.map((sheet, index) => {
        const active = sheet.id === activeSheetId;
        return (
          <div key={sheet.id} className="worksheet-tabs__item" role="presentation">
            <button
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`worksheet-tab-${sheet.id}`}
              type="button"
              role="tab"
              className="worksheet-tabs__tab"
              aria-selected={active}
              aria-controls={`worksheet-panel-${sheet.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(sheet.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {sheet.name}
            </button>
            <Menu
              triggerLabel="▾"
              triggerAriaLabel={`Worksheet options for ${sheet.name}`}
              menuLabel="Worksheet options"
              buttonVariant="ghost"
              items={[
                {
                  id: "rename",
                  label: "Rename",
                  onSelect: () => onRenameWorksheet(sheet),
                },
                {
                  id: "delete",
                  label: "Delete",
                  tone: "danger",
                  onSelect: () => onDeleteWorksheet(sheet),
                },
              ]}
            />
          </div>
        );
      })}
      <Button
        variant="ghost"
        className="worksheet-tabs__add"
        aria-label="Add worksheet"
        disabled={adding}
        onClick={onAddWorksheet}
      >
        +
      </Button>
    </div>
  );
}
