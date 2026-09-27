import { useRef, useState } from "react";
import type { Sheet } from "../types";
import WorksheetMenu from "./WorksheetMenu";

export interface SheetTabsProps {
  sheets: Sheet[];
  activeSheetId: string;
  onSelect: (sheetId: string) => void;
  /** Invoked when the "Add worksheet" button is clicked. */
  onAdd: () => void;
  /** Invoked when the "Rename" command is chosen from a sheet's options menu. */
  onRename: (sheet: Sheet) => void;
}

export default function SheetTabs({ sheets, activeSheetId, onSelect, onAdd, onRename }: SheetTabsProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  return (
    <div className="sheet-tabs">
      <div role="tablist" aria-label="Worksheets" className="sheet-tablist">
        {sheets.map((sheet) => {
          const active = sheet.id === activeSheetId;
          return (
            <div key={sheet.id} className="sheet-tab-group">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "sheet-tab active" : "sheet-tab"}
                onClick={() => onSelect(sheet.id)}
              >
                {sheet.name}
              </button>
              <button
                type="button"
                className="sheet-options"
                aria-label={`Worksheet options for ${sheet.name}`}
                aria-haspopup="menu"
                aria-expanded={menuFor === sheet.id}
                ref={(el) => {
                  optionRefs.current[sheet.id] = el;
                }}
                onClick={() => setMenuFor(menuFor === sheet.id ? null : sheet.id)}
              >
                ⋮
              </button>
              {menuFor === sheet.id && (
                <WorksheetMenu
                  items={[{ label: "Rename", onSelect: () => onRename(sheet) }]}
                  onClose={() => {
                    setMenuFor(null);
                    optionRefs.current[sheet.id]?.focus();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="add-sheet" aria-label="Add worksheet" onClick={onAdd}>
        +
      </button>
    </div>
  );
}
