import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { ContextMenu } from "../../ui/ContextMenu";
import type { MenuItem } from "../../ui/Menu";
import { DropdownOptions } from "./DropdownOptions";
import {
  cellCoordinate,
  columnLabel,
  indexRange,
  isCellSelected,
  sameSelection,
} from "../../domain/grid";
import { evaluateCells } from "../../domain/formula";
import { filterHeaderText, hiddenRowsForFilter } from "../../domain/filter";
import { dropdownValuesForCell } from "../../domain/validation";
import type { CellCoordinate, CellSelection, Worksheet, WorksheetStructureOperation } from "../../domain/types";

export interface CellEditState {
  row: number;
  col: number;
  /** Draft text shown in the inline editor, the cell and the formula bar. */
  value: string;
  /** Where the edit started: the grid shows its inline text box only for `grid`. */
  source: "grid" | "formulaBar";
}

export interface WorksheetGridProps {
  worksheet: Worksheet;
  /** Cell whose inline editor is open, with the uncommitted draft. */
  editing: CellEditState | null;
  onSelectRange(selection: CellSelection): void;
  onBeginEdit(row: number, col: number, seed?: string): void;
  onDraftChange(value: string): void;
  onCommitEdit(): void;
  onCancelEdit(): void;
  onClearCell(row: number, col: number): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onStructureOperation(operation: WorksheetStructureOperation, index: number): void;
  /** Opens the filter dialog of a column of the current filter region. */
  onFilterColumn(col: number): void;
  /** Commits one allowed value into a dropdown-validated cell. */
  onDropdownSelect(row: number, col: number, value: string): void;
}

interface DropdownState {
  coordinate: string;
  row: number;
  col: number;
  values: string[];
  x: number;
  y: number;
}

interface HeaderMenu {
  kind: "row" | "column";
  index: number;
  x: number;
  y: number;
}

interface CellMenu {
  coordinate: string;
  x: number;
  y: number;
}

const ROW_ITEMS: Array<{ id: string; label: string; operation: WorksheetStructureOperation; tone?: "danger" }> = [
  { id: "insert-row-above", label: "Insert 1 row above", operation: "insertRowAbove" },
  { id: "insert-row-below", label: "Insert 1 row below", operation: "insertRowBelow" },
  { id: "delete-row", label: "Delete row", operation: "deleteRow", tone: "danger" },
];

const COLUMN_ITEMS: Array<{ id: string; label: string; operation: WorksheetStructureOperation; tone?: "danger" }> = [
  { id: "insert-column-left", label: "Insert 1 column left", operation: "insertColumnLeft" },
  { id: "insert-column-right", label: "Insert 1 column right", operation: "insertColumnRight" },
  { id: "delete-column", label: "Delete column", operation: "deleteColumn", tone: "danger" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

/**
 * ARIA grid for the active worksheet. Every cell exposes its A1 coordinate as
 * the accessible name and its selection state through aria-selected. Cells are
 * selected by clicking or by dragging between two corners, edited in place
 * (inline text box `Edit <coordinate>`) or through the formula bar, and carry
 * the `Copy`, `Cut` and `Paste` commands in their context menu. Row numbers and
 * column letters are rowheader/columnheader elements whose right-click menu
 * offers the structure commands; a filtered region puts one
 * `Filter <header text>` button in each of its column headers, and records
 * hidden by that filter are not rendered at all while keeping every value.
 */
export function WorksheetGrid({
  worksheet,
  editing,
  onSelectRange,
  onBeginEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  onClearCell,
  onCopy,
  onCut,
  onPaste,
  onStructureOperation,
  onFilterColumn,
  onDropdownSelect,
}: WorksheetGridProps) {
  const [menu, setMenu] = useState<HeaderMenu | null>(null);
  const [cellMenu, setCellMenu] = useState<CellMenu | null>(null);
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);
  const [drag, setDrag] = useState<CellSelection | null>(null);
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editorInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<CellSelection | null>(null);
  const previousEditing = useRef<CellEditState | null>(editing);
  const persistedSelection = useRef(worksheet.selection);
  persistedSelection.current = worksheet.selection;

  const rows = indexRange(worksheet.rowCount);
  const columns = indexRange(worksheet.columnCount);
  const display = useMemo(() => evaluateCells(worksheet.cells), [worksheet.cells]);
  const selection = drag ?? worksheet.selection;
  // Filtering only hides records: their cells stay in the worksheet untouched.
  const hiddenRows = useMemo(
    () => hiddenRowsForFilter(worksheet, worksheet.filter),
    [worksheet, worksheet.filter],
  );
  const visibleRows = rows.filter((row) => !hiddenRows.has(row));
  const filterHeaders = useMemo(() => {
    const filter = worksheet.filter;
    if (!filter) return null;
    const headers = new Map<number, string>();
    for (let col = filter.range.minCol; col <= filter.range.maxCol; col += 1) {
      headers.set(col, filterHeaderText(worksheet, filter, col));
    }
    return headers;
  }, [worksheet, worksheet.filter]);

  const setDragSelection = (next: CellSelection | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const onSelectRef = useRef(onSelectRange);
  onSelectRef.current = onSelectRange;

  useEffect(() => {
    const finishDrag = () => {
      const finished = dragRef.current;
      if (!finished) return;
      dragRef.current = null;
      setDrag(null);
      if (!sameSelection(finished, persistedSelection.current)) onSelectRef.current(finished);
    };
    document.addEventListener("mouseup", finishDrag);
    return () => document.removeEventListener("mouseup", finishDrag);
  }, []);

  // Return focus to the cell that owned an inline editor once it closes.
  useEffect(() => {
    const closed = previousEditing.current;
    previousEditing.current = editing;
    if (!closed || editing || closed.source !== "grid") return;
    cellRefs.current[cellCoordinate(closed.row, closed.col)]?.focus();
  }, [editing]);

  // A freshly opened inline editor keeps the caret after the seeded text so
  // typing that started the edit keeps appending to it.
  useEffect(() => {
    const input = editorInputRef.current;
    if (!editing || !input || editing.source !== "grid") return;
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing?.row, editing?.col]);

  const focusCell = (row: number, col: number) => {
    cellRefs.current[cellCoordinate(row, col)]?.focus();
  };

  const current = selection.focus;

  const moveSelection = (rowDelta: number, colDelta: number, extend: boolean) => {
    const row = clamp(current.row + rowDelta, 0, worksheet.rowCount - 1);
    const col = clamp(current.col + colDelta, 0, worksheet.columnCount - 1);
    const next = extend
      ? { anchor: selection.anchor, focus: { row, col } }
      : { anchor: { row, col }, focus: { row, col } };
    setDragSelection(null);
    onSelectRange(next);
    focusCell(row, col);
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || isEditableTarget(event.target)) return;
    const key = event.key;
    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const rowDelta = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
      const colDelta = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
      moveSelection(rowDelta, colDelta, event.shiftKey);
      return;
    }
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      onBeginEdit(current.row, current.col);
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      onClearCell(current.row, current.col);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onBeginEdit(current.row, current.col, key);
    }
  };

  const openMenu = (kind: "row" | "column", index: number) => (event: MouseEvent) => {
    event.preventDefault();
    setMenu({ kind, index, x: event.clientX, y: event.clientY });
  };

  const openCellMenu = (row: number, col: number) => (event: MouseEvent) => {
    event.preventDefault();
    setCellMenu({ coordinate: cellCoordinate(row, col), x: event.clientX, y: event.clientY });
    if (!isCellSelected(selection, row, col)) {
      onSelectRange({ anchor: { row, col }, focus: { row, col } });
    }
  };

  const menuItems: MenuItem[] = menu
    ? (menu.kind === "row" ? ROW_ITEMS : COLUMN_ITEMS).map((item) => ({
        id: item.id,
        label: item.label,
        tone: item.tone,
        onSelect: () => onStructureOperation(item.operation, menu.index),
      }))
    : [];

  const openDropdown = (row: number, col: number, coordinate: string, values: string[]) => (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropdown({ coordinate, row, col, values, x: rect.left, y: rect.bottom });
  };

  const cellMenuItems: MenuItem[] = cellMenu
    ? [
        { id: "copy", label: "Copy", onSelect: () => onCopy() },
        { id: "cut", label: "Cut", onSelect: () => onCut() },
        { id: "paste", label: "Paste", onSelect: () => onPaste() },
      ]
    : [];

  return (
    <>
      <div
        role="grid"
        aria-label="Worksheet grid"
        aria-multiselectable="true"
        tabIndex={0}
        className="worksheet-grid"
        onKeyDown={handleGridKeyDown}
      >
        <div role="row" className="worksheet-grid__row worksheet-grid__row--header">
          <div role="presentation" className="worksheet-grid__rowheader worksheet-grid__corner" />
          {columns.map((col) => (
            <div
              key={col}
              role="columnheader"
              aria-label={columnLabel(col)}
              data-column={col}
              className="worksheet-grid__columnheader"
              onContextMenu={openMenu("column", col)}
            >
              {columnLabel(col)}
              {filterHeaders?.has(col) ? (
                <button
                  type="button"
                  className="worksheet-grid__filter"
                  aria-label={`Filter ${filterHeaders.get(col)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFilterColumn(col);
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
        {visibleRows.map((row) => (
          <div role="row" key={row} className="worksheet-grid__row">
            <div
              role="rowheader"
              aria-label={String(row + 1)}
              data-row={row}
              className="worksheet-grid__rowheader"
              onContextMenu={openMenu("row", row)}
            >
              {row + 1}
            </div>
            {columns.map((col) => {
              const coordinate = cellCoordinate(row, col);
              const selected = isCellSelected(selection, row, col);
              const isEditing = editing !== null && editing.row === row && editing.col === col;
              const inlineEditing = isEditing && editing?.source === "grid";
              const dropdownValues = inlineEditing
                ? null
                : dropdownValuesForCell(worksheet.validations, row, col);
              return (
                <div
                  key={coordinate}
                  ref={(node) => {
                    cellRefs.current[coordinate] = node;
                  }}
                  role="gridcell"
                  aria-label={coordinate}
                  aria-selected={selected}
                  tabIndex={-1}
                  data-selected={selected ? "true" : "false"}
                  data-editing={isEditing ? "true" : "false"}
                  className="worksheet-grid__cell"
                  onMouseDown={(event) => {
                    if (isEditingTarget(event.target)) return;
                    event.preventDefault();
                    focusCell(row, col);
                    if (inlineEditing) return;
                    setDragSelection({ anchor: { row, col }, focus: { row, col } });
                  }}
                  onMouseEnter={() => {
                    const active = dragRef.current;
                    if (!active) return;
                    setDragSelection({ anchor: active.anchor, focus: { row, col } });
                  }}
                  onDoubleClick={() => {
                    if (isEditing) return;
                    onBeginEdit(row, col);
                  }}
                  onContextMenu={openCellMenu(row, col)}
                >
                  {inlineEditing ? (
                    <input
                      ref={editorInputRef}
                      className="worksheet-grid__cell-input"
                      aria-label={`Edit ${coordinate}`}
                      value={editing.value}
                      autoFocus
                      onChange={(event) => onDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onCommitEdit();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          onCancelEdit();
                        }
                      }}
                      onBlur={() => onCommitEdit()}
                    />
                  ) : (
                    (isEditing ? editing?.value : display[coordinate]) ?? ""
                  )}
                  {dropdownValues ? (
                    <button
                      type="button"
                      className="worksheet-grid__cell-dropdown"
                      aria-label={`Open dropdown for ${coordinate}`}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={openDropdown(row, col, coordinate, dropdownValues)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {menu ? (
        <ContextMenu
          label={menu.kind === "row" ? `Row ${menu.index + 1} menu` : `Column ${columnLabel(menu.index)} menu`}
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {cellMenu ? (
        <ContextMenu
          label={`Cell ${cellMenu.coordinate} menu`}
          x={cellMenu.x}
          y={cellMenu.y}
          items={cellMenuItems}
          onClose={() => setCellMenu(null)}
        />
      ) : null}
      {dropdown ? (
        <DropdownOptions
          label={`Options for ${dropdown.coordinate}`}
          x={dropdown.x}
          y={dropdown.y}
          values={dropdown.values}
          onSelect={(value) => onDropdownSelect(dropdown.row, dropdown.col, value)}
          onClose={() => setDropdown(null)}
        />
      ) : null}
    </>
  );
}

/** True when a pointer press lands on the inline editor or a cell button. */
function isEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element && typeof element.closest === "function" && element.closest("input, textarea, button"),
  );
}
