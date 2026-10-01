import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { CellEditor } from "./CellEditor";
import { HeaderContextMenu, type HeaderMenuItem } from "./HeaderContextMenu";
import {
  filterColumnsOf,
  filterHeaderText,
  filterRangeBounds,
  isRowHidden,
} from "../domain/filter";
import {
  cellAddress,
  columnName,
  isCellSelected,
  shiftAddress,
  type CellSelection,
} from "../domain/spreadsheet";
import {
  COLUMN_MENU_ITEMS,
  ROW_MENU_ITEMS,
  type StructureOperation,
} from "../domain/structure";
import { dropdownRuleFor } from "../domain/validation";
import { cellInput, cellText, columnCount, rowCount, type WorksheetState } from "../domain/workbook";

export interface GridCellEdit {
  address: string;
  value: string;
}

export interface WorksheetGridProps {
  sheet: WorksheetState;
  selection: CellSelection;
  /** Inline edit owned by the editor page so the formula bar shows the same text. */
  edit: GridCellEdit | null;
  onSelect(address: string, options?: { extend?: boolean }): void;
  /** Called when a click or drag gesture finished, so the rectangle can be persisted. */
  onSelectEnd(): void;
  onStartEdit(address: string, initialValue: string): void;
  onEditChange(value: string): void;
  onEditCommit(value: string): void;
  onEditCancel(): void;
  /** External clipboard text pasted with Ctrl+V while the grid has focus. */
  onPasteText(text: string, start: string): void;
  /** `Paste` command of the cell context menu. */
  onPasteCommand(address: string): void;
  /** Copy/cut command of the toolbar or the cell context menu. */
  onCopyRange?(mode: "copy" | "cut"): void;
  /** Opens the `Filter <header text>` dialog of one filtered column (REQ-5-1-2). */
  onOpenFilter?(column: string): void;
  /** Chooses one allowed value of a dropdown-validated cell (REQ-5-2-1). */
  onSetCellValue?(address: string, value: string): void;
  /** Insert/delete a row or column of the active worksheet. */
  onStructureChange?(operation: StructureOperation): void;
  /** True while a structure change is in flight: the same commands stay visible but disabled. */
  structureBusy?: boolean;
  /** True while a cell write is in flight: no new edit or paste may start. */
  cellBusy?: boolean;
}

interface OpenMenu {
  axis: "row" | "column" | "cell";
  /** Zero-based target row or column index. */
  index: number;
  /** Cell coordinate for a cell menu. */
  address?: string;
  x: number;
  y: number;
}

/** Open option list of a dropdown-validated cell and the screen position of its button. */
interface OpenOptions {
  address: string;
  x: number;
  y: number;
}

export function WorksheetGrid({
  sheet,
  selection,
  edit,
  onSelect,
  onSelectEnd,
  onStartEdit,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onPasteText,
  onPasteCommand,
  onCopyRange,
  onOpenFilter,
  onSetCellValue,
  onStructureChange,
  structureBusy = false,
  cellBusy = false,
}: WorksheetGridProps) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [menuOrigin, setMenuOrigin] = useState<HTMLElement | null>(null);
  const [options, setOptions] = useState<OpenOptions | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const editingRef = useRef<string | null>(null);

  const rows = rowCount(sheet);
  const columns = columnCount(sheet);
  const gridSize = { rows, columns };
  const filterColumns = filterColumnsOf(sheet.filter);
  const headerRow = filterRangeBounds(sheet.filter?.range)?.top ?? null;

  // A finished drag is persisted, and focus returns to the grid once an inline edit ends.
  useEffect(() => {
    const stopDragging = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      onSelectEnd();
    };
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, [onSelectEnd]);

  useEffect(() => {
    const previous = editingRef.current;
    editingRef.current = edit?.address ?? null;
    if (previous !== null && edit === null) gridRef.current?.focus({ preventScroll: true });
  }, [edit]);

  // An open option list closes when the pointer goes anywhere else.
  useEffect(() => {
    if (!options) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !(target instanceof Element)) return;
      if (target.closest(".worksheet-grid__options")) return;
      if (target.closest(".worksheet-grid__dropdown") === null) setOptions(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [options]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && (event.key === "c" || event.key === "x")) {
      // The selected rectangle is copied or cut instead of the page text.
      event.preventDefault();
      if (!cellBusy) onCopyRange?.(event.key === "c" ? "copy" : "cut");
      return;
    }
    const current = selection.start;
    let next: string | null = null;
    switch (event.key) {
      case "ArrowUp":
        next = shiftAddress(current, -1, 0, gridSize);
        break;
      case "ArrowDown":
        next = shiftAddress(current, 1, 0, gridSize);
        break;
      case "ArrowLeft":
        next = shiftAddress(current, 0, -1, gridSize);
        break;
      case "ArrowRight":
        next = shiftAddress(current, 0, 1, gridSize);
        break;
      case "F2":
        event.preventDefault();
        if (!cellBusy) onStartEdit(current, cellInput(sheet, current));
        return;
      default:
        next = null;
    }
    if (next) {
      event.preventDefault();
      onSelect(next, { extend: event.shiftKey });
      onSelectEnd();
      return;
    }
    // Typing a printable character starts an inline edit and replaces the cell content.
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !cellBusy
    ) {
      event.preventDefault();
      onStartEdit(current, event.key);
    }
  }

  function openStructureMenu(event: MouseEvent<HTMLDivElement>, axis: "row" | "column", index: number) {
    event.preventDefault();
    if (structureBusy || !onStructureChange) return;
    setMenuOrigin(event.currentTarget);
    setMenu({ axis, index, x: event.clientX, y: event.clientY });
  }

  function openCellMenu(event: MouseEvent<HTMLDivElement>, address: string) {
    event.preventDefault();
    // Right-clicking inside the current rectangle keeps it (the menu acts on it);
    // right-clicking elsewhere selects that single cell first.
    if (!isCellSelected(address, selection)) {
      onSelect(address);
      onSelectEnd();
    }
    setMenuOrigin(event.currentTarget);
    setMenu({ axis: "cell", index: 0, address, x: event.clientX, y: event.clientY });
  }

  function menuItems(target: OpenMenu): HeaderMenuItem[] {
    if (target.axis === "row") {
      return ROW_MENU_ITEMS.map((item) => ({
        id: item.action,
        label: item.label,
        disabled: structureBusy,
        onSelect: () => onStructureChange?.({ axis: "row", index: target.index, action: item.action }),
      }));
    }
    if (target.axis === "column") {
      return COLUMN_MENU_ITEMS.map((item) => ({
        id: item.action,
        label: item.label,
        disabled: structureBusy,
        onSelect: () =>
          onStructureChange?.({ axis: "column", index: target.index, action: item.action }),
      }));
    }
    return [
      {
        id: "copy",
        label: "Copy",
        disabled: cellBusy,
        onSelect: () => onCopyRange?.("copy"),
      },
      {
        id: "cut",
        label: "Cut",
        disabled: cellBusy,
        onSelect: () => onCopyRange?.("cut"),
      },
      {
        id: "paste",
        label: "Paste",
        disabled: cellBusy,
        onSelect: () => onPasteCommand(target.address ?? selection.start),
      },
    ];
  }

  function menuLabel(target: OpenMenu): string {
    if (target.axis === "row") return `Row ${target.index + 1} options`;
    if (target.axis === "column") return `Column ${columnName(target.index)} options`;
    return `Cell ${target.address} options`;
  }

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Worksheet grid"
      aria-multiselectable="true"
      className="worksheet-grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        if (cellBusy) return;
        // An empty clipboard text (no clipboard permission, or nothing copied outside the
        // app) may still mean "paste the range copied inside the worksheet".
        onPasteText(event.clipboardData?.getData("text/plain") ?? "", selection.start);
      }}
    >
      <div role="row" className="worksheet-grid__row worksheet-grid__row--header">
        <div role="columnheader" aria-hidden="true" className="worksheet-grid__corner" />
        {Array.from({ length: columns }, (_, column) => (
          <div
            key={column}
            role="columnheader"
            aria-label={columnName(column)}
            tabIndex={-1}
            className="worksheet-grid__column"
            onContextMenu={(event) => openStructureMenu(event, "column", column)}
          >
            {columnName(column)}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          role="row"
          className="worksheet-grid__row"
          hidden={isRowHidden(sheet, row + 1)}
        >
          <div
            role="rowheader"
            aria-label={String(row + 1)}
            tabIndex={-1}
            className="worksheet-grid__rowheader"
            onContextMenu={(event) => openStructureMenu(event, "row", row)}
          >
            {row + 1}
          </div>
          {Array.from({ length: columns }, (_, column) => {
            const address = cellAddress(row, column);
            const selected = isCellSelected(address, selection);
            const editing = edit?.address === address;
            const letter = columnName(column);
            // A filtered column offers its `Filter <header text>` button in the header cell.
            const withFilterButton =
              headerRow !== null && row === headerRow && filterColumns.includes(letter);
            const dropdown = dropdownRuleFor(sheet.validations, address);
            return (
              <div
                key={address}
                id={`cell-${sheet.id}-${address}`}
                role="gridcell"
                aria-label={address}
                aria-selected={selected}
                className="worksheet-grid__cell"
                data-selected={selected || undefined}
                data-editing={editing || undefined}
                onMouseDown={(event) => {
                  if (event.button !== 0 || event.target instanceof HTMLInputElement) return;
                  // Keep keyboard focus on the grid so typing starts an inline edit, without
                  // scrolling the page (that would move the cells under a drag).
                  gridRef.current?.focus({ preventScroll: true });
                  draggingRef.current = true;
                  onSelect(address, { extend: event.shiftKey });
                }}
                onMouseEnter={() => {
                  if (draggingRef.current) onSelect(address, { extend: true });
                }}
                onDoubleClick={() => {
                  if (!cellBusy) onStartEdit(address, cellInput(sheet, address));
                }}
                onContextMenu={(event) => openCellMenu(event, address)}
              >
                {editing ? (
                  <CellEditor
                    address={address}
                    value={edit.value}
                    busy={cellBusy}
                    onChange={onEditChange}
                    onCommit={onEditCommit}
                    onCancel={onEditCancel}
                  />
                ) : (
                  cellText(sheet, address)
                )}
                {withFilterButton ? (
                  <button
                    type="button"
                    className="worksheet-grid__filter"
                    aria-label={`Filter ${filterHeaderText(sheet, sheet.filter, letter)}`}
                    aria-haspopup="dialog"
                    disabled={cellBusy}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFilter?.(letter);
                    }}
                  />
                ) : null}
                {dropdown ? (
                  <button
                    type="button"
                    className="worksheet-grid__dropdown"
                    aria-label={`Open dropdown for ${address}`}
                    aria-haspopup="listbox"
                    aria-expanded={options?.address === address}
                    disabled={cellBusy}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (options?.address === address) {
                        setOptions(null);
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();
                      setOptions({ address, x: rect.left, y: rect.bottom });
                    }}
                  />
                ) : null}
                {dropdown && options?.address === address ? (
                  <div
                    role="listbox"
                    aria-label={`Options for ${address}`}
                    className="worksheet-grid__options"
                    style={{ left: options.x, top: options.y }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      const entries = Array.from(
                        event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
                      );
                      const current = entries.findIndex((entry) => entry === document.activeElement);
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        const next = current + (event.key === "ArrowDown" ? 1 : -1);
                        entries[(next + entries.length) % entries.length]?.focus();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setOptions(null);
                      } else if (event.key === "Enter" && current >= 0) {
                        event.preventDefault();
                        setOptions(null);
                        onSetCellValue?.(address, entries[current].textContent ?? "");
                      }
                    }}
                  >
                    {(dropdown.values ?? []).map((option) => (
                      <div
                        key={option}
                        role="option"
                        aria-selected={cellText(sheet, address) === option}
                        className="worksheet-grid__option"
                        tabIndex={-1}
                        onClick={() => {
                          setOptions(null);
                          onSetCellValue?.(address, option);
                        }}
                      >
                        {option}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

      {menu ? (
        <HeaderContextMenu
          label={menuLabel(menu)}
          x={menu.x}
          y={menu.y}
          items={menuItems(menu)}
          returnFocus={menuOrigin}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
