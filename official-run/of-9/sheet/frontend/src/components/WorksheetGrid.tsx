import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import type { CellRecord, ValidationRule } from "../domain/types";
import { getClipboardBuffer, setLastExternalText } from "../domain/clipboard";
import {
  cellCoordinate,
  columnLabel,
  gridDimensions,
  parseCoordinate,
  selectionContains,
  singleCellSelection,
  type GridPosition,
  type GridSelection,
} from "../domain/grid";
import { dropdownRuleAt } from "../domain/validation";
import { GridContextMenu } from "./GridContextMenu";

export interface WorksheetGridProps {
  cells: Record<string, CellRecord>;
  selection: GridSelection;
  /** Row numbers (1-based) that are hidden by an active filter view. */
  hiddenRows?: ReadonlySet<number>;
  /** Header cells of an active filter view that render "Filter <header>" buttons. */
  filterHeaderCells?: ReadonlyArray<{ row: number; column: number }>;
  /** Validation rules of the worksheet; dropdown rules render cell pickers. */
  validationRules?: ValidationRule[];
  onSelect(selection: GridSelection): void;
  onOpenFilter?(column: number): void;
  onCommitCell(row: number, column: number, value: string): void;
  onCopy(): void;
  onCut(): void;
  onPasteBuffer(): void;
  onPasteText(text: string, start: GridPosition): void;
  onInsertRow?(row: number, position: "above" | "below"): void;
  onDeleteRow?(row: number): void;
  onInsertColumn?(column: number, position: "left" | "right"): void;
  onDeleteColumn?(column: number): void;
}

interface GridMenuState {
  x: number;
  y: number;
  row: number | null;
  column: number | null;
  coordinate: string | null;
}

interface EditingState {
  row: number;
  column: number;
}

interface DropdownOpen {
  row: number;
  column: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || event.key === "Menu" || (event.shiftKey && event.key === "F10");
}

export function WorksheetGrid({
  cells,
  selection,
  hiddenRows,
  filterHeaderCells,
  validationRules,
  onSelect,
  onOpenFilter,
  onCommitCell,
  onCopy,
  onCut,
  onPasteBuffer,
  onPasteText,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
}: WorksheetGridProps) {
  const { rows, columns } = gridDimensions(cells);
  const [menu, setMenu] = useState<GridMenuState | null>(null);
  const [editing, setEditingState] = useState<EditingState | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<DropdownOpen | null>(null);
  const editingRef = useRef<EditingState | null>(null);
  const dragStartRef = useRef<GridPosition>({ row: 1, column: 1 });
  const cancelEditRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setEditing = (value: EditingState | null) => {
    editingRef.current = value;
    setEditingState(value);
  };

  const cellContent = (row: number, column: number): string => {
    const cell = cells[cellCoordinate(row, column)];
    return cell ? (cell.formula ?? cell.value) : "";
  };

  const moveSelectionTo = (row: number, column: number) => {
    onSelect(singleCellSelection(row, column));
    requestAnimationFrame(() => {
      document.getElementById(`cell-${cellCoordinate(row, column)}`)?.focus();
    });
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: MouseEvent) => {
      const node = (event.target as Element | null)?.closest?.("[data-coordinate]");
      const coordinate = node?.getAttribute("data-coordinate");
      const position = coordinate ? parseCoordinate(coordinate) : null;
      if (!position) return;
      onSelectRef.current({ start: dragStartRef.current, end: { row: position.row, column: position.column } });
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const startDrag = (row: number, column: number) => {
    dragStartRef.current = { row, column };
    setDragging(true);
    onSelect(singleCellSelection(row, column));
  };

  const startEdit = (row: number, column: number) => {
    setDropdownOpen(null);
    setEditing({ row, column });
    setEditDraft(cellContent(row, column));
    cancelEditRef.current = false;
  };

  const commitEdit = () => {
    const target = editingRef.current;
    if (!target) return;
    setEditing(null);
    onCommitCell(target.row, target.column, editDraft);
    const nextRow = clamp(target.row + 1, 1, rows);
    moveSelectionTo(nextRow, target.column);
  };

  const cancelEdit = () => {
    cancelEditRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur();
    const target = editingRef.current;
    if (target) {
      requestAnimationFrame(() => {
        document.getElementById(`cell-${cellCoordinate(target.row, target.column)}`)?.focus();
      });
    }
  };

  const finishEdit = () => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditing(null);
      return;
    }
    const target = editingRef.current;
    if (!target) return;
    setEditing(null);
    onCommitCell(target.row, target.column, editDraft);
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: number, column: number) => {
    if (editing) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier) {
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        onCopy();
        return;
      }
      if (key === "x") {
        event.preventDefault();
        onCut();
        return;
      }
      if (key === "v") {
        if (getClipboardBuffer()) {
          event.preventDefault();
          onPasteBuffer();
        }
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      moveSelectionTo(clamp(row + 1, 1, rows), column);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      startEdit(row, column);
      return;
    }
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    const nextRow = clamp(row + move[0], 1, rows);
    const nextColumn = clamp(column + move[1], 1, columns);
    if (event.shiftKey) {
      onSelect({ start: selection.start, end: { row: nextRow, column: nextColumn } });
    } else {
      onSelect(singleCellSelection(nextRow, nextColumn));
    }
    requestAnimationFrame(() => {
      document.getElementById(`cell-${cellCoordinate(nextRow, nextColumn)}`)?.focus();
    });
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain");
    if (text && text.trim() !== "") {
      setLastExternalText(text);
      onPasteText(text, selection.start);
    } else {
      onPasteBuffer();
    }
  };

  const openMenuAt = (event: ReactMouseEvent, row: number | null, column: number | null, coordinate: string | null) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, row, column, coordinate });
  };

  const closeMenu = () => setMenu(null);

  const rowMenuItems =
    menu?.row != null
      ? [
          {
            id: "insert-above",
            label: "Insert 1 row above",
            onSelect: () => onInsertRow?.(menu.row as number, "above"),
          },
          {
            id: "insert-below",
            label: "Insert 1 row below",
            onSelect: () => onInsertRow?.(menu.row as number, "below"),
          },
          {
            id: "delete",
            label: "Delete row",
            onSelect: () => onDeleteRow?.(menu.row as number),
          },
        ]
      : [];

  const columnMenuItems =
    menu?.column != null
      ? [
          {
            id: "insert-left",
            label: "Insert 1 column left",
            onSelect: () => onInsertColumn?.(menu.column as number, "left"),
          },
          {
            id: "insert-right",
            label: "Insert 1 column right",
            onSelect: () => onInsertColumn?.(menu.column as number, "right"),
          },
          {
            id: "delete",
            label: "Delete column",
            onSelect: () => onDeleteColumn?.(menu.column as number),
          },
        ]
      : [];

  const cellMenuItems =
    menu?.coordinate != null
      ? [
          { id: "copy", label: "Copy", onSelect: () => onCopy() },
          { id: "cut", label: "Cut", onSelect: () => onCut() },
          { id: "paste", label: "Paste", onSelect: () => onPasteBuffer() },
        ]
      : [];

  const menuItems = menu?.coordinate != null ? cellMenuItems : menu?.row != null ? rowMenuItems : columnMenuItems;
  const menuLabel =
    menu?.coordinate ??
    (menu?.row != null ? `Row ${menu.row}` : menu?.column != null ? `Column ${columnLabel((menu.column ?? 1) - 1)}` : "Grid");

  const isFilterHeaderCell = (row: number, column: number) =>
    filterHeaderCells?.some((cell) => cell.row === row && cell.column === column) ?? false;

  // Selecting another cell or starting a new drag closes any open dropdown.
  useEffect(() => {
    setDropdownOpen(null);
  }, [selection]);

  return (
    <div
      className="sheet-grid"
      role="grid"
      aria-label="Worksheet grid"
      aria-multiselectable="true"
      data-testid="worksheet-grid"
      onPaste={handlePaste}
    >
      <div role="row" className="sheet-grid__row sheet-grid__row--header">
        <div role="columnheader" className="sheet-grid__corner" aria-label="Corner" />
        {Array.from({ length: columns }, (_, columnIndex) => {
          const label = columnLabel(columnIndex);
          return (
            <div
              key={label}
              role="columnheader"
              className="sheet-grid__header"
              aria-label={label}
              tabIndex={0}
              onContextMenu={(event) => openMenuAt(event, null, columnIndex + 1, null)}
              onKeyDown={(event) => {
                if (isContextMenuKey(event)) {
                  event.preventDefault();
                  setMenu({ x: event.currentTarget.getBoundingClientRect().right, y: event.currentTarget.getBoundingClientRect().bottom, row: null, column: columnIndex + 1, coordinate: null });
                }
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => {
        const row = rowIndex + 1;
        if (hiddenRows?.has(row)) return null;
        return (
          <div key={row} role="row" className="sheet-grid__row">
            <div
              role="rowheader"
              className="sheet-grid__row-number"
              aria-label={String(row)}
              tabIndex={0}
              onContextMenu={(event) => openMenuAt(event, row, null, null)}
              onKeyDown={(event) => {
                if (isContextMenuKey(event)) {
                  event.preventDefault();
                  setMenu({ x: event.currentTarget.getBoundingClientRect().right, y: event.currentTarget.getBoundingClientRect().bottom, row, column: null, coordinate: null });
                }
              }}
            >
              {row}
            </div>
            {Array.from({ length: columns }, (__, columnIndex) => {
              const column = columnIndex + 1;
              const coordinate = cellCoordinate(row, column);
              const cell = cells[coordinate];
              const selected = selectionContains(selection, row, column);
              const active = selection.start.row === row && selection.start.column === column;
              const isEditing = editing?.row === row && editing?.column === column;
              const filterHeader = isFilterHeaderCell(row, column);
              const headerText = cell ? cell.value : "";
              const dropdownRule = dropdownRuleAt(validationRules, coordinate);
              const dropdownValues = dropdownRule?.type === "dropdown" ? (dropdownRule.allowedValues ?? []) : [];
              const isDropdownOpen = dropdownOpen?.row === row && dropdownOpen?.column === column;
              const className = [
                "sheet-grid__cell",
                selected ? "sheet-grid__cell--selected" : "",
                active ? "sheet-grid__cell--active" : "",
                filterHeader ? "sheet-grid__cell--filter" : "",
                dropdownValues.length > 0 ? "sheet-grid__cell--dropdown" : "",
                isDropdownOpen ? "sheet-grid__cell--dropdown-open" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={coordinate}
                  id={`cell-${coordinate}`}
                  role="gridcell"
                  aria-label={coordinate}
                  aria-selected={selected}
                  data-coordinate={coordinate}
                  tabIndex={active ? 0 : -1}
                  className={className}
                  onMouseDown={() => startDrag(row, column)}
                  onDoubleClick={() => startEdit(row, column)}
                  onContextMenu={(event) => openMenuAt(event, null, null, coordinate)}
                  onKeyDown={(event) => handleCellKeyDown(event, row, column)}
                >
                  {isEditing ? (
                    <input
                      className="sheet-grid__editor"
                      aria-label={`Edit ${coordinate}`}
                      value={editDraft}
                      autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitEdit();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEdit();
                        }
                      }}
                      onBlur={finishEdit}
                    />
                  ) : (
                    <span className="sheet-grid__cell-text">{cell ? cell.value : ""}</span>
                  )}
                  {filterHeader && !isEditing ? (
                    <button
                      type="button"
                      className="sheet-grid__filter-button"
                      aria-label={`Filter ${headerText}`}
                      title={`Filter ${headerText}`}
                      onMouseDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenFilter?.(column);
                      }}
                    >
                      ⏷
                    </button>
                  ) : null}
                  {dropdownValues.length > 0 && !isEditing ? (
                    <button
                      type="button"
                      className="sheet-grid__dropdown-button"
                      aria-label={`Open dropdown for ${coordinate}`}
                      title={`Open dropdown for ${coordinate}`}
                      aria-haspopup="listbox"
                      aria-expanded={isDropdownOpen}
                      onMouseDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDropdownOpen(isDropdownOpen ? null : { row, column });
                      }}
                    >
                      ▾
                    </button>
                  ) : null}
                  {isDropdownOpen ? (
                    <div
                      role="listbox"
                      aria-label={`Options for ${coordinate}`}
                      className="sheet-grid__dropdown-list"
                      onMouseDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setDropdownOpen(null);
                          document.getElementById(`cell-${coordinate}`)?.focus();
                        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".sheet-grid__dropdown-option"));
                          const current = options.indexOf(document.activeElement as HTMLElement);
                          const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                          options[next]?.focus();
                        }
                      }}
                    >
                      {dropdownValues.map((value) => (
                        <button
                          type="button"
                          role="option"
                          key={value}
                          className="sheet-grid__dropdown-option"
                          tabIndex={0}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => {
                            setDropdownOpen(null);
                            onCommitCell(row, column, value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setDropdownOpen(null);
                              onCommitCell(row, column, value);
                            }
                          }}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      <GridContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        label={menuLabel}
        items={menuItems}
        onClose={closeMenu}
      />
    </div>
  );
}
