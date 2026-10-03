import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";

import { filterColumns, hiddenRowSet, parseRange } from "../domain/filter";
import { allowedValuesOf, listRuleForCell } from "../domain/validation";
import {
  cellDisplayText,
  cellInputText,
  cellName,
  columnLabel,
  isCellInSelection,
  parseCellName,
  selectionTopLeft,
  type Selection,
  type StructureAction,
  type StructureAxis,
  type StructureCommand,
  type Worksheet,
} from "../domain/types";
import { GridContextMenu, type GridMenuItem } from "./GridContextMenu";

/** Inline editor contents for one grid cell. */
export interface GridEditing {
  cell: string;
  input: string;
}

export interface WorksheetGridProps {
  worksheet: Worksheet;
  /** Prevents overlapping structure changes while one is in flight. */
  structureDisabled?: boolean;
  onStructureCommand?(command: StructureCommand): void;
  /** Inline editor state; only set while the cell is edited in the grid itself. */
  editing?: GridEditing | null;
  onStartEdit?(cell: string, input: string): void;
  onInputChange?(input: string): void;
  onCommitEdit?(): void;
  onCancelEdit?(): void;
  onSelect?(selection: Selection): void;
  /** Text pasted from the clipboard (Ctrl+V) starting at the given cell. */
  onPaste?(startCell: string, text: string): void;
  /** The "Paste" menu command; the caller decides internal range vs external clipboard. */
  onPasteRequest?(startCell: string): void;
  /** Ctrl+C and the "Copy" menu command. */
  onCopy?(): void;
  /** Ctrl+X and the "Cut" menu command. */
  onCut?(): void;
  /** Source rectangle of the internal copy/cut clipboard, highlighted in the grid. */
  clipboardRange?: { mode: "copy" | "cut"; source: Selection } | null;
  /** Opens the `Filter <header text>` dialog of one filtered column. */
  onOpenFilter?(column: number): void;
  /** Writes the chosen option of a dropdown-validated cell. */
  onSelectDropdownValue?(cell: string, value: string): void;
}

interface OpenMenu {
  axis: StructureAxis;
  index: number;
  x: number;
  y: number;
}

interface OpenCellMenu {
  cell: string;
  x: number;
  y: number;
}

const DEFAULT_SELECTION: Selection = { anchor: "A1", focus: "A1" };

const ROW_MENU_ITEMS: ReadonlyArray<{ action: StructureAction; label: string }> = [
  { action: "insert-above", label: "Insert 1 row above" },
  { action: "insert-below", label: "Insert 1 row below" },
  { action: "delete", label: "Delete row" },
];

const COLUMN_MENU_ITEMS: ReadonlyArray<{ action: StructureAction; label: string }> = [
  { action: "insert-left", label: "Insert 1 column left" },
  { action: "insert-right", label: "Insert 1 column right" },
  { action: "delete", label: "Delete column" },
];

const MOVE_KEYS: Record<string, { row: number; column: number }> = {
  ArrowUp: { row: -1, column: 0 },
  ArrowDown: { row: 1, column: 0 },
  ArrowLeft: { row: 0, column: -1 },
  ArrowRight: { row: 0, column: 1 },
};

/** ARIA grid for a worksheet: coordinates are the accessible cell names. */
export function WorksheetGrid({
  worksheet,
  structureDisabled = false,
  onStructureCommand,
  editing = null,
  onStartEdit,
  onInputChange,
  onCommitEdit,
  onCancelEdit,
  onSelect,
  onPaste,
  onPasteRequest,
  onCopy,
  onCut,
  clipboardRange = null,
  onOpenFilter,
  onSelectDropdownValue,
}: WorksheetGridProps) {
  const rows = Array.from({ length: worksheet.rowCount }, (_, row) => row);
  const columns = Array.from({ length: worksheet.columnCount }, (_, column) => column);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [cellMenu, setCellMenu] = useState<OpenCellMenu | null>(null);
  const [drag, setDrag] = useState<Selection | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  // Filter views only hide rows: the cells, their order and their values stay untouched.
  const hiddenRows = useMemo(() => hiddenRowSet(worksheet), [worksheet]);
  const filterColumnsByIndex = useMemo(
    () => new Map(filterColumns(worksheet).map((entry) => [entry.column, entry.header])),
    [worksheet],
  );
  const filterTopRow = parseRange(worksheet.filter?.range)?.top ?? -1;
  const dragRef = useRef<Selection | null>(null);
  const dragAnchor = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const selection = drag ?? worksheet.selection ?? DEFAULT_SELECTION;
  const activeName = selection.focus ?? "A1";

  useEffect(() => {
    setMenu(null);
    setCellMenu(null);
    setDrag(null);
    setOpenDropdown(null);
    dragRef.current = null;
    dragAnchor.current = null;
  }, [worksheet.id]);

  // Finishing a drag can happen outside the grid, so the release is tracked on the window.
  useEffect(() => {
    function finishSelection() {
      if (!dragAnchor.current) return;
      const current = dragRef.current;
      dragAnchor.current = null;
      dragRef.current = null;
      setDrag(null);
      if (current) onSelect?.(current);
    }
    window.addEventListener("mouseup", finishSelection);
    return () => window.removeEventListener("mouseup", finishSelection);
  }, [onSelect]);

  function startSelection(name: string) {
    setOpenDropdown(null);
    dragAnchor.current = name;
    const next = { anchor: name, focus: name };
    dragRef.current = next;
    setDrag(next);
  }

  function extendSelection(name: string) {
    const anchor = dragAnchor.current;
    if (!anchor || dragRef.current?.focus === name) return;
    const next = { anchor, focus: name };
    dragRef.current = next;
    setDrag(next);
  }

  function openMenu(axis: StructureAxis, index: number, x: number, y: number, trigger: HTMLElement) {
    if (structureDisabled || !onStructureCommand) return;
    setCellMenu(null);
    triggerRef.current = trigger;
    setMenu({ axis, index, x, y });
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>, axis: StructureAxis, index: number) {
    event.preventDefault();
    openMenu(axis, index, event.clientX, event.clientY, event.currentTarget);
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLElement>, axis: StructureAxis, index: number) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(axis, index, rect.left, rect.bottom, event.currentTarget);
  }

  function closeMenu() {
    setMenu(null);
    triggerRef.current?.focus();
  }

  function handleCellContextMenu(event: MouseEvent<HTMLElement>, name: string) {
    event.preventDefault();
    setMenu(null);
    onSelect?.({ anchor: name, focus: name });
    setCellMenu({ cell: name, x: event.clientX, y: event.clientY });
  }

  function closeCellMenu() {
    const cell = cellMenu?.cell;
    setCellMenu(null);
    if (cell) rootRef.current?.querySelector<HTMLElement>(`[role="gridcell"][aria-label="${cell}"]`)?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (!onPaste) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    onPaste(selectionTopLeft(selection), text);
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "c" && onCopy) {
        event.preventDefault();
        onCopy();
        return;
      }
      if (key === "x" && onCut) {
        event.preventDefault();
        onCut();
        return;
      }
    }
    const position = parseCellName(activeName);
    if (!position) return;
    const move = MOVE_KEYS[event.key];
    if (move) {
      event.preventDefault();
      const next = cellName(
        Math.max(0, Math.min(worksheet.rowCount - 1, position.row + move.row)),
        Math.max(0, Math.min(worksheet.columnCount - 1, position.column + move.column)),
      );
      onSelect?.({ anchor: next, focus: next });
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      onStartEdit?.(activeName, cellInputText(worksheet, activeName));
      return;
    }
    if (event.key === "Escape") {
      if (openDropdown) {
        event.preventDefault();
        setOpenDropdown(null);
        return;
      }
      if (editing) {
        event.preventDefault();
        onCancelEdit?.();
      }
      return;
    }
    // Typing a printable character starts the inline editor with that character.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onStartEdit?.(activeName, event.key);
    }
  }

  const items: readonly GridMenuItem[] = menu
    ? (menu.axis === "row" ? ROW_MENU_ITEMS : COLUMN_MENU_ITEMS).map(({ action, label }) => ({
        id: `${menu.axis}-${action}`,
        label,
        disabled: structureDisabled,
        onSelect: () => onStructureCommand?.({ axis: menu.axis, action, index: menu.index }),
      }))
    : [];

  const cellItems: readonly GridMenuItem[] = cellMenu
    ? [
        {
          id: `${cellMenu.cell}-copy`,
          label: "Copy",
          onSelect: () => onCopy?.(),
        },
        {
          id: `${cellMenu.cell}-cut`,
          label: "Cut",
          onSelect: () => onCut?.(),
        },
        {
          id: `${cellMenu.cell}-paste`,
          label: "Paste",
          onSelect: () => onPasteRequest?.(cellMenu.cell),
        },
      ]
    : [];

  return (
    <>
      <div
        ref={rootRef}
        className="sheet-grid"
        role="grid"
        aria-label="Worksheet grid"
        aria-multiselectable="true"
        aria-rowcount={worksheet.rowCount + 1}
        aria-colcount={worksheet.columnCount + 1}
        onKeyDown={handleGridKeyDown}
        onPaste={handlePaste}
      >
        <div className="sheet-grid__row sheet-grid__row--headers" role="row" aria-rowindex={1}>
          <div className="sheet-grid__corner" role="presentation" />
          {columns.map((column) => {
            const label = columnLabel(column);
            return (
              <div
                key={label}
                role="columnheader"
                aria-label={label}
                aria-colindex={column + 2}
                tabIndex={0}
                className="sheet-grid__column-header"
                onContextMenu={(event) => handleContextMenu(event, "column", column)}
                onKeyDown={(event) => handleHeaderKeyDown(event, "column", column)}
              >
                {label}
              </div>
            );
          })}
        </div>
        {rows.map((row) => (
          <div className="sheet-grid__row" role="row" aria-rowindex={row + 2} key={row} hidden={hiddenRows.has(row)}>
            <div
              role="rowheader"
              aria-label={String(row + 1)}
              hidden={hiddenRows.has(row)}
              aria-colindex={1}
              tabIndex={0}
              className="sheet-grid__row-header"
              onContextMenu={(event) => handleContextMenu(event, "row", row)}
              onKeyDown={(event) => handleHeaderKeyDown(event, "row", row)}
            >
              {row + 1}
            </div>
            {columns.map((column) => {
              const name = cellName(row, column);
              const selected = isCellInSelection(selection, row, column);
              const editingHere = editing?.cell === name;
              const marked =
                clipboardRange !== null && isCellInSelection(clipboardRange.source, row, column);
              const headerText = row === filterTopRow ? filterColumnsByIndex.get(column) : undefined;
              const dropdownRule = listRuleForCell(worksheet, name);
              return (
                <div
                  key={name}
                  role="gridcell"
                  aria-label={name}
                  aria-colindex={column + 2}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={[
                    "sheet-grid__cell",
                    marked ? `sheet-grid__cell--${clipboardRange?.mode}` : "",
                  ].filter(Boolean).join(" ")}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    startSelection(name);
                  }}
                  onMouseEnter={() => extendSelection(name)}
                  onDoubleClick={() => onStartEdit?.(name, cellInputText(worksheet, name))}
                  onContextMenu={(event) => handleCellContextMenu(event, name)}
                >
                  {editingHere ? (
                    <input
                      className="sheet-grid__cell-input"
                      aria-label={`Edit ${name}`}
                      value={editing.input}
                      autoFocus
                      onChange={(event) => onInputChange?.(event.target.value)}
                      onMouseDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onCommitEdit?.();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          onCancelEdit?.();
                        }
                      }}
                      onBlur={() => onCommitEdit?.()}
                    />
                  ) : (
                    cellDisplayText(worksheet, name)
                  )}
                  {headerText !== undefined ? (
                    <button
                      type="button"
                      className="sheet-grid__filter-button"
                      aria-label={`Filter ${headerText}`}
                      aria-haspopup="dialog"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => onOpenFilter?.(column)}
                    />
                  ) : null}
                  {dropdownRule && !editingHere ? (
                    <span className="sheet-grid__cell-dropdown">
                      <button
                        type="button"
                        className="sheet-grid__cell-dropdown-button"
                        aria-label={`Open dropdown for ${name}`}
                        aria-haspopup="listbox"
                        aria-expanded={openDropdown === name}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => setOpenDropdown(openDropdown === name ? null : name)}
                      />
                      {openDropdown === name ? (
                        <div
                          role="listbox"
                          aria-label={`Values for ${name}`}
                          className="sheet-grid__cell-listbox"
                        >
                          {allowedValuesOf(dropdownRule).map((option) => (
                            <div
                              key={option}
                              role="option"
                              aria-selected={cellDisplayText(worksheet, name) === option}
                              tabIndex={0}
                              className="sheet-grid__cell-option"
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => {
                                setOpenDropdown(null);
                                onSelectDropdownValue?.(name, option);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setOpenDropdown(null);
                                  onSelectDropdownValue?.(name, option);
                                }
                              }}
                            >
                              {option}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {menu ? (
        <GridContextMenu
          label={menu.axis === "row" ? `Row ${menu.index + 1} menu` : `Column ${columnLabel(menu.index)} menu`}
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={closeMenu}
        />
      ) : null}
      {cellMenu ? (
        <GridContextMenu
          label={`Cell ${cellMenu.cell} menu`}
          x={cellMenu.x}
          y={cellMenu.y}
          items={cellItems}
          onClose={closeCellMenu}
        />
      ) : null}
    </>
  );
}
