import { useEffect, useRef, useState } from "react";

import { Menu, type MenuAction } from "./Menu";
import {
  cellName,
  columnName,
  gridSize,
  normalizeRange,
  parseCoord,
  rangeContains,
  type CellRange,
} from "../lib/spreadsheet";
import { filterHeaderRow, rowMatchesFilter, type SheetFilter } from "../lib/filter";
import type { ColumnPosition, RowPosition, ValidationRule } from "../lib/workbooks";

interface GridProps {
  cells: Record<string, string>;
  /** Derived formula results (formula cells only). */
  results: Record<string, string>;
  /** The active cell (anchor of the selection). */
  selectedCell: string;
  /** The complete selection rectangle. */
  selection: CellRange;
  /** Whether a session range clipboard (copy/cut) exists for this worksheet. */
  hasRangeClipboard: boolean;
  /** Active filter view for the worksheet (REQ-5-1-2); null when off. */
  filter?: SheetFilter | null;
  /** Validation rules for the worksheet (REQ-5-2). */
  validationRules?: ValidationRule[];
  onSelect: (coord: string) => void;
  onSelectRange: (start: string, end: string) => void;
  onCommit: (coord: string, value: string) => void;
  onPasteText: (text: string, target: string) => void;
  onCopyRange: (range: CellRange) => void;
  onCutRange: (range: CellRange) => void;
  onPasteRange: (target: string) => void;
  onInsertRow: (index: number, position: RowPosition) => void;
  onDeleteRow: (index: number) => void;
  onInsertColumn: (index: number, position: ColumnPosition) => void;
  onDeleteColumn: (index: number) => void;
  /** Open the filter dialog for a header (REQ-5-1-2). */
  onFilterColumn: (column: string, headerText: string) => void;
}

interface EditingState {
  coord: string;
  value: string;
}

interface DragState {
  anchor: string;
  current: string;
  moved: boolean;
}

interface GridMenuState {
  kind: "row" | "column" | "cell";
  /** 1-based row number for rows, 1-based column number for columns. */
  index: number;
  x: number;
  y: number;
}

interface DropdownState {
  coord: string;
  options: string[];
  x: number;
  y: number;
}

function openMenuFromEvent(
  event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  kind: GridMenuState["kind"],
  index: number,
): { x: number; y: number } {
  if ("clientX" in event) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 2 };
}

export function Grid({
  cells,
  results,
  selectedCell,
  selection,
  hasRangeClipboard,
  filter,
  validationRules = [],
  onSelect,
  onSelectRange,
  onCommit,
  onPasteText,
  onCopyRange,
  onCutRange,
  onPasteRange,
  onInsertRow,
  onDeleteRow,
  onInsertColumn,
  onDeleteColumn,
  onFilterColumn,
}: GridProps) {
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [menu, setMenu] = useState<GridMenuState | null>(null);
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);
  const [previewRange, setPreviewRange] = useState<CellRange | null>(null);
  const editingRef = useRef<EditingState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const lastPasteRef = useRef<string | null>(null);
  const dragEndedRef = useRef(false);
  const { rows, cols } = gridSize(cells);
  const templateColumns = `3.25rem repeat(${cols}, minmax(6.5rem, 1fr))`;

  // Rows hidden by the active filter view (REQ-5-1-2): nonmatching rows
  // inside the filter rectangle are hidden only — never deleted or reordered.
  const hiddenRows = new Set<number>();
  for (let row = 1; row <= rows; row += 1) {
    if (!rowMatchesFilter(cells, results, filter, row)) hiddenRows.add(row);
  }
  const filterHeaderRowNumber = filterHeaderRow(filter);
  const filterRange = filter
    ? (() => {
        const from = parseCoord(filter.start);
        const to = parseCoord(filter.end);
        if (!from || !to) return null;
        return {
          colMin: Math.min(from.col, to.col),
          colMax: Math.max(from.col, to.col),
        };
      })()
    : null;

  function dropdownRuleFor(coord: string): ValidationRule | null {
    return (
      validationRules.find(
        (rule) =>
          rule.type === "dropdown" &&
          rangeContains(coord, { start: rule.start, end: rule.end }),
      ) ?? null
    );
  }

  function openDropdown(coord: string, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rule = dropdownRuleFor(coord);
    if (!rule || !rule.allowed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDropdown({
      coord,
      options: [...rule.allowed],
      x: rect.left,
      y: rect.bottom + 2,
    });
  }

  useEffect(() => {
    const finalize = () => handleMouseUp();
    window.addEventListener("mouseup", finalize);
    return () => window.removeEventListener("mouseup", finalize);
  });

  // Escape closes the open dropdown option list (REQ-5-2-1).
  useEffect(() => {
    if (!dropdown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDropdown(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropdown]);

  function setEditingState(state: EditingState | null) {
    editingRef.current = state;
    setEditing(state);
  }

  function startEditing(coord: string, value: string) {
    setEditingState({ coord, value });
  }

  /** Commit the pending inline edit (optionally selecting another cell). */
  function commitEditing(nextCoord?: string) {
    const current = editingRef.current;
    if (!current) return;
    setEditingState(null);
    const { coord, value } = current;
    if (value !== (cells[coord] ?? "")) {
      onCommit(coord, value);
    }
    if (nextCoord) onSelect(nextCoord);
  }

  function cancelEditing() {
    setEditingState(null);
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // While the inline editor is open, the text box handles its own keys
    // (Enter commits, Escape cancels); don't re-start editing from the bubble.
    if (editingRef.current) return;
    // Ctrl/Cmd+C / X / V are handled at the editor-page level so the
    // shortcuts work regardless of which element holds focus.
    if (event.ctrlKey || event.metaKey) return;
    const position = parseCoord(selectedCell);
    if (!position) return;
    let nextRow = position.row;
    let nextCol = position.col;
    if (event.key === "ArrowUp") nextRow -= 1;
    else if (event.key === "ArrowDown") nextRow += 1;
    else if (event.key === "ArrowLeft") nextCol -= 1;
    else if (event.key === "ArrowRight") nextCol += 1;
    else if (event.key === "Enter") {
      event.preventDefault();
      startEditing(selectedCell, cells[selectedCell] ?? "");
      return;
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      startEditing(selectedCell, event.key);
      return;
    } else {
      return;
    }
    if (nextRow < 1 || nextRow > rows || nextCol < 0 || nextCol >= cols) return;
    event.preventDefault();
    onSelect(cellName(nextRow, nextCol));
  }

  function openMenu(
    event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
    kind: GridMenuState["kind"],
    index: number,
  ) {
    event.preventDefault();
    menuTriggerRef.current = event.currentTarget as HTMLElement;
    const position = openMenuFromEvent(event, kind, index);
    setMenu({ kind, index, x: position.x, y: position.y });
  }

  function closeMenu() {
    setMenu(null);
    menuTriggerRef.current?.focus();
    menuTriggerRef.current = null;
  }

  const menuActions: MenuAction[] = menu
    ? menu.kind === "row"
      ? [
          {
            label: "Insert 1 row above",
            onSelect: () => onInsertRow(menu.index, "above"),
          },
          {
            label: "Insert 1 row below",
            onSelect: () => onInsertRow(menu.index, "below"),
          },
          {
            label: "Delete row",
            onSelect: () => onDeleteRow(menu.index),
          },
        ]
      : menu.kind === "column"
        ? [
            {
              label: "Insert 1 column left",
              onSelect: () => onInsertColumn(menu.index, "left"),
            },
            {
              label: "Insert 1 column right",
              onSelect: () => onInsertColumn(menu.index, "right"),
            },
            {
              label: "Delete column",
              onSelect: () => onDeleteColumn(menu.index),
            },
          ]
        : [
            {
              label: "Copy",
              onSelect: () => onCopyRange(selection),
            },
            {
              label: "Cut",
              onSelect: () => onCutRange(selection),
            },
            {
              label: "Paste",
              onSelect: () => {
                if (hasRangeClipboard) {
                  onPasteRange(selectedCell);
                } else {
                  void pasteClipboardInto(selectedCell);
                }
              },
            },
          ]
    : [];

  async function readClipboardText(): Promise<string | null> {
    try {
      if (navigator.clipboard?.readText) {
        return await navigator.clipboard.readText();
      }
    } catch {
      // clipboard access is not granted; fall back to the last paste buffer
    }
    return lastPasteRef.current;
  }

  async function pasteClipboardInto(target: string) {
    const text = await readClipboardText();
    if (text === null) return;
    onPasteText(text, target);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    // While editing inline, let the native text box handle the paste.
    if (editingRef.current) return;
    // A session range clipboard (copy/cut) takes priority: Ctrl+V pastes the
    // captured rectangle into the selected cell. Without one, external
    // clipboard text is pasted as a two-dimensional table (REQ-3-1-2).
    if (hasRangeClipboard) {
      event.preventDefault();
      onPasteRange(selectedCell);
      return;
    }
    const text = event.clipboardData?.getData("text/plain");
    if (text === undefined || text === null) return;
    event.preventDefault();
    lastPasteRef.current = text;
    onPasteText(text, selectedCell);
  }

  function handleCellMouseDown(coord: string, event: React.MouseEvent<HTMLDivElement>) {
    if (editingRef.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    // Move keyboard focus to the cell so subsequent shortcut keys (copy/cut/
    // paste, arrow navigation, direct typing) land on the grid even when the
    // previous focus was a text input.
    (event.currentTarget as HTMLElement).focus();
    dragRef.current = { anchor: coord, current: coord, moved: false };
    setPreviewRange({ start: coord, end: coord });
  }

  function handleCellMouseEnter(coord: string) {
    const state = dragRef.current;
    if (!state) return;
    if (coord === state.current) return;
    dragRef.current = { ...state, current: coord, moved: true };
    setPreviewRange(normalizeRange(state.anchor, coord));
  }

  function handleMouseUp() {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    setPreviewRange(null);
    if (state.moved) {
      dragEndedRef.current = true;
      onSelectRange(state.anchor, state.current);
    } else {
      onSelect(state.anchor);
    }
  }

  const menuKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    kind: GridMenuState["kind"],
    index: number,
  ) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      openMenu(event, kind, index);
    }
  };

  return (
    <div className="grid-wrap" onMouseUp={handleMouseUp}>
      <div
        className="grid"
        role="grid"
        aria-label="Worksheet grid"
        aria-multiselectable="true"
        aria-colcount={cols}
        aria-rowcount={rows + 1}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onPaste={handlePaste}
        style={{ gridTemplateColumns: templateColumns }}
      >
        <div role="row" className="grid-row grid-header-row">
          <div role="columnheader" className="grid-corner" aria-label="" />
          {Array.from({ length: cols }, (_, index) => (
            <div
              key={index}
              role="columnheader"
              className="col-header"
              tabIndex={0}
              data-column={index + 1}
              onContextMenu={(event) => openMenu(event, "column", index + 1)}
              onKeyDown={(event) => menuKeyDown(event, "column", index + 1)}
            >
              {columnName(index)}
            </div>
          ))}
        </div>
        {Array.from({ length: rows }, (_, rowIndex) => {
          const row = rowIndex + 1;
          if (hiddenRows.has(row)) return null;
          return (
            <div key={row} role="row" className="grid-row">
              <div
                role="rowheader"
                className="row-header"
                tabIndex={0}
                data-row={row}
                onContextMenu={(event) => openMenu(event, "row", row)}
                onKeyDown={(event) => menuKeyDown(event, "row", row)}
              >
                {row}
              </div>
              {Array.from({ length: cols }, (_, colIndex) => {
                const coord = cellName(row, colIndex);
                const value = cells[coord] ?? "";
                const display = results[coord] ?? value;
                const activeRange = previewRange ?? selection;
                const insideSelection = rangeContains(coord, activeRange);
                const isCurrentCell = coord === selectedCell;
                const isEditing = editing?.coord === coord;
                const dropdownRule = dropdownRuleFor(coord);
                const isFilterHeader =
                  filterRange !== null &&
                  filterHeaderRowNumber !== null &&
                  row === filterHeaderRowNumber &&
                  colIndex >= filterRange.colMin &&
                  colIndex <= filterRange.colMax;
                const headerText = isFilterHeader ? display : "";
                const className = [
                  "cell",
                  insideSelection ? "selected" : "",
                  isCurrentCell ? "current-cell" : "",
                  dropdownRule ? "dropdown-cell" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={coord}
                    role="gridcell"
                    aria-label={coord}
                    aria-selected={insideSelection}
                    data-coord={coord}
                    tabIndex={-1}
                    className={className}
                    onMouseDown={(event) => handleCellMouseDown(coord, event)}
                    onMouseEnter={() => handleCellMouseEnter(coord)}
                    onClick={() => {
                      if (dragEndedRef.current) {
                        dragEndedRef.current = false;
                        return;
                      }
                      const current = editingRef.current;
                      if (current) {
                        if (current.coord !== coord) commitEditing(coord);
                        return;
                      }
                      onSelect(coord);
                    }}
                    onDoubleClick={() => startEditing(coord, value)}
                    onContextMenu={(event) => {
                      if (editingRef.current) return;
                      openMenu(event, "cell", 0);
                    }}
                  >
                    {isEditing ? (
                      <input
                        className="cell-editor"
                        aria-label={`Edit ${coord}`}
                        value={editing.value}
                        autoFocus
                        onChange={(event) =>
                          setEditingState({ coord, value: event.target.value })
                        }
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            commitEditing();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            cancelEditing();
                          }
                        }}
                        onBlur={() => commitEditing()}
                      />
                    ) : (
                      <span className="cell-value">{display}</span>
                    )}
                    {isFilterHeader && headerText !== "" && (
                      <button
                        type="button"
                        className="filter-header-button"
                        aria-label={`Filter ${headerText}`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onFilterColumn(columnName(colIndex), headerText);
                        }}
                      >
                        ▾
                      </button>
                    )}
                    {!isEditing && dropdownRule && (
                      <button
                        type="button"
                        className="dropdown-cell-button"
                        aria-label={`Open dropdown for ${coord}`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => openDropdown(coord, event)}
                      >
                        ▾
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {dropdown && (
        <>
          <div className="dropdown-backdrop" onClick={() => setDropdown(null)} />
          <div
            role="listbox"
            className="dropdown-popup"
            aria-label={`Options for ${dropdown.coord}`}
            style={{ left: dropdown.x, top: dropdown.y }}
          >
            {dropdown.options.map((option) => (
              <div
                key={option}
                role="option"
                className="dropdown-option"
                onClick={() => {
                  onCommit(dropdown.coord, option);
                  setDropdown(null);
                }}
              >
                {option}
              </div>
            ))}
          </div>
        </>
      )}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          actions={menuActions}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
