import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import type { Worksheet } from "../domain/types";

export interface WorksheetTabsProps {
  worksheets: readonly Worksheet[];
  activeWorksheetId: string;
  gridId: string;
  onChange(worksheetId: string): void;
  onAdd(): void;
  onRename(worksheetId: string): void;
  onDelete(worksheetId: string): void;
}

/**
 * Worksheet tab bar: one accessible tab per worksheet (order and active state)
 * plus a per-tab options menu and the "Add worksheet" button.
 */
export function WorksheetTabs({
  worksheets,
  activeWorksheetId,
  gridId,
  onChange,
  onAdd,
  onRename,
  onDelete,
}: WorksheetTabsProps) {
  const active = worksheets.find((worksheet) => worksheet.id === activeWorksheetId) ?? worksheets[0];

  const move = (from: number, direction: 1 | -1) => {
    const next = (from + direction + worksheets.length) % worksheets.length;
    onChange(worksheets[next].id);
  };

  return (
    <div className="worksheet-tabs">
      <div role="tablist" aria-label="Worksheets" className="worksheet-tabs__list">
        {worksheets.map((worksheet, index) => {
          const selected = worksheet.id === active?.id;
          const optionsLabel = `Worksheet options for ${worksheet.name}`;
          return (
            <div key={worksheet.id} role="presentation" className="worksheet-tabs__item">
              <button
                id={`worksheet-tab-${worksheet.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? gridId : undefined}
                tabIndex={selected ? 0 : -1}
                className={`worksheet-tabs__tab${selected ? " is-active" : ""}`}
                onClick={() => onChange(worksheet.id)}
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
                triggerLabel={optionsLabel}
                triggerContent={<span aria-hidden="true">▾</span>}
                menuLabel={optionsLabel}
                buttonVariant="ghost"
                items={[
                  { id: "rename", label: "Rename", onSelect: () => onRename(worksheet.id) },
                  { id: "delete", label: "Delete", tone: "danger", onSelect: () => onDelete(worksheet.id) },
                ]}
              />
            </div>
          );
        })}
      </div>
      <Button variant="primary" className="worksheet-tabs__add" onClick={onAdd}>
        Add worksheet
      </Button>
    </div>
  );
}
