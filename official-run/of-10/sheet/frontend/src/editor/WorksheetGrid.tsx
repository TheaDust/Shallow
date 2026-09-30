import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { clampCell, columnIndexToLabel, makeCellId, parseCellId, range, type CellAddress } from "../lib/cells";
import { displayedCellText } from "../workbooks/cells";
import type { WorksheetData } from "../workbooks/types";
import { CellDropdown } from "./CellDropdown";
import { ContextMenu } from "./ContextMenu";
import { dropdownCellIds, filterHeaderText, hiddenRowsOf } from "./filters";
import { GridContextMenu } from "./GridContextMenu";
import { isCellSelected, selectionRegion, type GridSelection } from "./selection";
import { commandsOf, type StructureAxis, type StructureCommand } from "./structure";

export interface GridEditingState {
  /** Cell whose inline editor is open, or null when the grid is not being edited in place. */
  cellId: string | null;
  /** Text of the edit in progress, kept in sync with the formula bar. */
  text: string | null;
  onStart(cellId: string, seedText?: string): void;
  onChange(text: string): void;
  onCommit(): void;
  onCancel(): void;
}

export interface WorksheetGridProps {
  worksheet: WorksheetData;
  selection: GridSelection;
  onSelectionChange(selection: GridSelection): void;
  editing: GridEditingState;
  /** True while the internal range clipboard holds a rectangle the grid can paste. */
  hasRangeClipboard: boolean;
  /** Ctrl+C or the menu command; returns the text to place on the system clipboard. */
  onCopyRange(): string;
  /** Ctrl+X or the menu command; returns the text to place on the system clipboard. */
  onCutRange(): string;
  /**
   * Paste from the keyboard, the context menu or the toolbar; system clipboard text when known.
   * `start` is the cell a menu command was opened on; without it the paste uses the selection.
   */
  onPasteRange(text: string | null, start?: CellAddress): void;
  /** Opens the filter dialog of one column of the filter view; the button sits in its header cell. */
  onFilterColumn?(column: number): void;
  /** Writes the option a dropdown cell selected, through the normal cell write. */
  onSelectDropdownValue?(cellId: string, value: string): void;
  /**
   * Runs one command of the row-number or column-header menu on `index` (a 1-based row number or
   * column index) of the active worksheet.
   */
  onStructureCommand?(axis: StructureAxis, command: StructureCommand, index: number): void;
  busy?: boolean;
}

/** Allowed values of the dropdown rule covering a cell, if any. */
function dropdownValuesOf(worksheet: WorksheetData, cellId: string, address: CellAddress): string[] | null {
  for (const rule of worksheet.validations ?? []) {
    const covers =
      rule.type === "dropdown" &&
      address.row >= rule.range.top &&
      address.row <= rule.range.bottom &&
      address.column >= rule.range.left &&
      address.column <= rule.range.right;
    if (covers) return rule.allowedValues ?? [];
  }
  return null;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

export function WorksheetGrid({
  worksheet,
  selection,
  onSelectionChange,
  editing,
  hasRangeClipboard,
  onCopyRange,
  onCutRange,
  onPasteRange,
  onFilterColumn,
  onSelectDropdownValue,
  onStructureCommand,
  busy = false,
}: WorksheetGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; cellId: string } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ axis: StructureAxis; index: number; x: number; y: number } | null>(
    null,
  );
  const columns = range(1, worksheet.columnCount);
  const rows = range(1, worksheet.rowCount);
  const filter = worksheet.filter ?? null;
  const hiddenRows = useMemo(() => hiddenRowsOf(worksheet, filter), [worksheet, filter]);
  const dropdownCells = useMemo(() => dropdownCellIds(worksheet), [worksheet]);

  useEffect(() => {
    const stopDragging = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, []);

  /**
   * The clipboard shortcuts act on the selected rectangle even when the focus sits on the page
   * (a finished drag can leave the body focused); the grid's own key handler owns the case where the
   * grid itself has the focus, and a text field keeps its normal copy/paste behaviour.
   */
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (isTextEntry(event.target)) return;
      const grid = gridRef.current;
      if (!grid || grid.contains(event.target as Node)) return;
      const key = event.key.toLowerCase();
      if (key === "c") onCopyRange();
      else if (key === "x") onCutRange();
      else if (key === "v" && hasRangeClipboard) {
        event.preventDefault();
        onPasteRange(null);
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [hasRangeClipboard, onCopyRange, onCutRange, onPasteRange]);

  const select = (address: CellAddress, extend: boolean) => {
    const target = clampCell(address, worksheet.rowCount, worksheet.columnCount);
    onSelectionChange({ anchor: extend ? selection.anchor : target, focus: target });
  };

  const move = (rowDelta: number, columnDelta: number, extend: boolean) => {
    select({ row: selection.focus.row + rowDelta, column: selection.focus.column + columnDelta }, extend);
  };

  const openMenuFor = (cellId: string, point: { x: number; y: number }) => {
    const address = parseCellId(cellId);
    if (!address) return;
    // Right clicking inside the selected rectangle keeps it, so the menu still commands that range.
    if (!isCellSelected(selection, address)) onSelectionChange({ anchor: address, focus: address });
    setHeaderMenu(null);
    const bounds = wrapperRef.current?.getBoundingClientRect();
    setMenu({ x: point.x - (bounds?.left ?? 0), y: point.y - (bounds?.top ?? 0), cellId });
  };

  /** Right clicking a row number or a column header opens that header's structure menu. */
  const openHeaderMenu = (axis: StructureAxis, index: number, point: { x: number; y: number }) => {
    setMenu(null);
    const bounds = wrapperRef.current?.getBoundingClientRect();
    setHeaderMenu({ axis, index, x: point.x - (bounds?.left ?? 0), y: point.y - (bounds?.top ?? 0) });
  };

  const closeHeaderMenu = () => {
    setHeaderMenu(null);
    gridRef.current?.focus({ preventScroll: true });
  };

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isTextEntry(event.target)) return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "c") {
        // The browser still fires the copy event, which fills the system clipboard.
        onCopyRange();
        return;
      }
      if (key === "x") {
        onCutRange();
        return;
      }
      if (key === "v") {
        // The internal clipboard pastes right here; otherwise the paste event carries the text.
        if (hasRangeClipboard) {
          event.preventDefault();
          onPasteRange(null);
        }
        return;
      }
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const cellId = makeCellId(selection.focus.row, selection.focus.column);
      const cellElement = gridRef.current?.querySelector(`[data-cell-id="${cellId}"]`);
      const cellBounds = cellElement?.getBoundingClientRect();
      openMenuFor(cellId, {
        x: cellBounds ? cellBounds.left + 4 : 0,
        y: cellBounds ? cellBounds.bottom : 0,
      });
      return;
    }
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        move(-1, 0, event.shiftKey);
        return;
      case "ArrowDown":
        event.preventDefault();
        move(1, 0, event.shiftKey);
        return;
      case "ArrowLeft":
        event.preventDefault();
        move(0, -1, event.shiftKey);
        return;
      case "ArrowRight":
        event.preventDefault();
        move(0, 1, event.shiftKey);
        return;
      case "Enter":
        event.preventDefault();
        move(1, 0, false);
        return;
      case "Escape":
        editing.onCancel();
        return;
      default:
        break;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      editing.onStart(makeCellId(selection.focus.row, selection.focus.column), event.key);
    }
  };

  const region = selectionRegion(selection);

  return (
    <div className="sheet-grid__wrapper" ref={wrapperRef}>
      <div
        ref={gridRef}
        role="grid"
        aria-label="Worksheet grid"
        aria-multiselectable="true"
        aria-rowcount={worksheet.rowCount}
        aria-colcount={worksheet.columnCount}
        aria-busy={busy || undefined}
        className="sheet-grid"
        style={{ "--sheet-columns": worksheet.columnCount } as CSSProperties}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onPaste={(event) => {
          if (isTextEntry(event.target)) return;
          const text = event.clipboardData?.getData("text/plain") ?? "";
          event.preventDefault();
          onPasteRange(text);
        }}
        onCopy={(event) => {
          if (isTextEntry(event.target)) return;
          event.preventDefault();
          event.clipboardData?.setData("text/plain", onCopyRange());
        }}
        onCut={(event) => {
          if (isTextEntry(event.target)) return;
          event.preventDefault();
          event.clipboardData?.setData("text/plain", onCutRange());
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div role="row" className="sheet-grid__row sheet-grid__row--header">
          <div className="sheet-grid__corner" aria-hidden="true" />
          {columns.map((column) => (
            <div
              key={column}
              role="columnheader"
              aria-label={columnIndexToLabel(column)}
              className="sheet-grid__header-cell"
              onContextMenu={(event) => {
                event.preventDefault();
                if (onStructureCommand) openHeaderMenu("column", column, { x: event.clientX, y: event.clientY });
              }}
            >
              {columnIndexToLabel(column)}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div role="row" key={row} className="sheet-grid__row" hidden={hiddenRows.has(row) || undefined}>
            <div
              role="rowheader"
              aria-label={String(row)}
              className="sheet-grid__row-header"
              onContextMenu={(event) => {
                event.preventDefault();
                if (onStructureCommand) openHeaderMenu("row", row, { x: event.clientX, y: event.clientY });
              }}
            >
              {row}
            </div>
            {columns.map((column) => {
              const cellId = makeCellId(row, column);
              const address = { row, column };
              const selected = isCellSelected(selection, address);
              const isEditing = editing.cellId === cellId;
              const active = region.top === row && region.left === column;
              const isHeaderCell = filter !== null && row === filter.region.top && column >= filter.region.left && column <= filter.region.right;
              const dropdownValues = dropdownCells.has(cellId) ? dropdownValuesOf(worksheet, cellId, address) : null;
              return (
                <div
                  key={cellId}
                  role="gridcell"
                  aria-label={cellId}
                  aria-selected={selected}
                  data-cell-id={cellId}
                  data-selected={selected ? "true" : undefined}
                  data-active={active ? "true" : undefined}
                  className="sheet-grid__cell"
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    if (isTextEntry(event.target)) return;
                    event.preventDefault();
                    // Focusing the grid keeps keyboard navigation working without letting the browser
                    // scroll the page, which would move the cell under the pointer.
                    gridRef.current?.focus({ preventScroll: true });
                    dragging.current = true;
                    select(address, event.shiftKey);
                  }}
                  onMouseEnter={() => {
                    if (!dragging.current) return;
                    onSelectionChange({ anchor: selection.anchor, focus: clampCell(address, worksheet.rowCount, worksheet.columnCount) });
                  }}
                  onDoubleClick={(event) => {
                    if (isTextEntry(event.target)) return;
                    event.preventDefault();
                    dragging.current = false;
                    editing.onStart(cellId);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    dragging.current = false;
                    openMenuFor(cellId, { x: event.clientX, y: event.clientY });
                  }}
                >
                  {isEditing ? (
                    <input
                      className="sheet-grid__editor"
                      type="text"
                      aria-label={`Edit ${cellId}`}
                      value={editing.text ?? ""}
                      autoFocus
                      onChange={(event) => editing.onChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          editing.onCommit();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          editing.onCancel();
                          gridRef.current?.focus({ preventScroll: true });
                        }
                      }}
                      onBlur={() => editing.onCommit()}
                    />
                  ) : (
                    displayedCellText(worksheet, cellId)
                  )}
                  {isHeaderCell && onFilterColumn ? (
                    <button
                      type="button"
                      className="sheet-grid__cell-action"
                      data-filtered={filter?.columns.some((entry) => entry.column === column) ? "true" : undefined}
                      aria-label={`Filter ${filterHeaderText(worksheet, filter, column)}`}
                      aria-haspopup="dialog"
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={() => onFilterColumn(column)}
                    />
                  ) : null}
                  {dropdownValues && onSelectDropdownValue ? (
                    <CellDropdown
                      cellId={cellId}
                      values={dropdownValues}
                      currentValue={displayedCellText(worksheet, cellId)}
                      onSelect={(value) => onSelectDropdownValue(cellId, value)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {menu ? (
        <GridContextMenu
          position={menu}
          onCut={() => {
            onCutRange();
          }}
          onCopy={() => {
            onCopyRange();
          }}
          onPaste={() => onPasteRange(null, parseCellId(menu.cellId) ?? undefined)}
          onClose={() => {
            setMenu(null);
            gridRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      {headerMenu && onStructureCommand ? (
        <ContextMenu
          label={headerMenu.axis === "row" ? `Row ${headerMenu.index} menu` : `Column ${columnIndexToLabel(headerMenu.index)} menu`}
          position={headerMenu}
          onClose={closeHeaderMenu}
          items={commandsOf(headerMenu.axis).map((command) => ({
            id: command.id,
            label: command.label,
            run: () => onStructureCommand(headerMenu.axis, command, headerMenu.index),
          }))}
        />
      ) : null}
    </div>
  );
}
