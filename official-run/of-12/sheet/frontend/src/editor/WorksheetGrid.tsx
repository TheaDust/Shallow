import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { dropdownRuleAt, parseValidationRules, type DropdownRule } from "../lib/data-validation";
import { activeFilter, filterBounds, hiddenRowIndexes } from "../lib/filter-view";
import { cellDisplayText, worksheetResults } from "../lib/formula";
import {
  cellCoordinate,
  columnLabel,
  isCellInRange,
  normalizeRange,
  parseCellCoordinate,
  type SelectionRange,
} from "../lib/spreadsheet";
import type { ColumnStructureAction, RowStructureAction, Worksheet } from "../lib/workbooks";
import { CellDropdown } from "./CellDropdown";
import { GridContextMenu, type GridContextMenuItem } from "./GridContextMenu";

export type StructureAction = RowStructureAction | ColumnStructureAction;

/** One command of a row-number or column-header menu, addressed by its 0-based index. */
export type StructureChange =
  | { kind: "row"; action: RowStructureAction; index: number }
  | { kind: "column"; action: ColumnStructureAction; index: number };

/** Command labels, in the order the menus expose them. */
const ROW_MENU_ACTIONS: ReadonlyArray<{ action: RowStructureAction; label: string }> = [
  { action: "insert-above", label: "Insert 1 row above" },
  { action: "insert-below", label: "Insert 1 row below" },
  { action: "delete", label: "Delete row" },
];

const COLUMN_MENU_ACTIONS: ReadonlyArray<{ action: ColumnStructureAction; label: string }> = [
  { action: "insert-left", label: "Insert 1 column left" },
  { action: "insert-right", label: "Insert 1 column right" },
  { action: "delete", label: "Delete column" },
];

/** The right-clicked target of the grid context menu: a header or one cell. */
type MenuTarget =
  | { kind: "row"; index: number }
  | { kind: "column"; index: number }
  | { kind: "cell"; coordinate: string };

export interface WorksheetGridProps {
  worksheet: Worksheet;
  busy: boolean;
  /**
   * The newest rectangular selection of this worksheet: a single cell, or the rectangle between
   * `anchor` and `focus`.
   */
  onSelect(range: SelectionRange): void;
  onCommitCell(coordinate: string, value: string): Promise<boolean>;
  onStructureChange(change: StructureChange): Promise<boolean>;
  /**
   * Puts the selected rectangle on the clipboard (and remembers it for an in-application paste).
   * Returns the text the browser clipboard should receive, or `null` when nothing was copied.
   */
  onCopySelection(mode: "copy" | "cut"): string | null;
  /** External clipboard text delivered by a paste event (Ctrl+V) aimed at the grid. */
  onPasteText(text: string): void;
  /** The context menu's `Paste` command: the page reads the external clipboard. */
  onPasteFromClipboard(): void;
  /** The `Filter <header text>` button of one column of the worksheet's filter view. */
  onOpenFilter(column: string, header: string): void;
  /** Column whose filter dialog is currently open, mirrored by `aria-expanded`. */
  openFilterColumn?: string | null;
}

interface MenuState {
  target: MenuTarget;
  x: number;
  y: number;
}

export function cellDomId(worksheetId: string, coordinate: string): string {
  return `${worksheetId}-cell-${coordinate}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function WorksheetGrid({
  worksheet,
  busy,
  onSelect,
  onCommitCell,
  onStructureChange,
  onCopySelection,
  onPasteText,
  onPasteFromClipboard,
  onOpenFilter,
  openFilterColumn = null,
}: WorksheetGridProps) {
  const [editing, setEditing] = useState<{ coordinate: string; draft: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragPreview, setDragPreview] = useState<SelectionRange | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<SelectionRange | null>(null);
  const skipBlurRef = useRef(false);
  const clickHandledRef = useRef(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const range = useMemo(
    () => normalizeRange(dragPreview ?? worksheet.selection),
    [dragPreview, worksheet.selection],
  );
  /**
   * The grid shows a formula cell's calculated result and the raw text of every other cell; the
   * raw text stays the cell's stored value, so the inline editor and the formula bar keep it.
   * Results are derived from the cell map on every render: a worksheet object may be reused while
   * its cells changed, so caching them on the map identity could keep a stale result.
   */
  const results = worksheetResults(worksheet.cells);
  /**
   * Filtering changes visibility only: the filter view hides the rows no condition accepts, while
   * every cell (and therefore the CSV export and any pivot source) keeps its value and its place.
   * Both lists are derived on every render: a worksheet object (or its arrays) may be reused while
   * the records changed, so caching them on that identity could keep a stale filter or rule.
   */
  const filter = activeFilter(worksheet.filters);
  const hiddenRows = hiddenRowIndexes(filter, worksheet.cells);
  const dropdownRules = parseValidationRules(worksheet.validations);
  const headerRow = filter ? filterBounds(filter).minRow : -1;
  const currentCell = worksheet.selection.anchor;
  const dragging = dragPreview !== null;

  /**
   * A drag runs while the pointer is down: the anchor is the cell the drag started on, the focus
   * follows the pointer over the cells of this grid. The rectangle is committed once, on release.
   */
  useEffect(() => {
    if (!dragging) return;

    const coordinateAt = (target: EventTarget | null): string | null => {
      const element = target instanceof Element ? target.closest("[data-cell-coordinate]") : null;
      if (!(element instanceof HTMLElement) || !gridRef.current?.contains(element)) return null;
      return element.getAttribute("data-cell-coordinate");
    };

    const handleMove = (event: MouseEvent) => {
      const current = dragRef.current;
      const coordinate = coordinateAt(event.target);
      if (!current || !coordinate || coordinate === current.focus) return;
      const next = { anchor: current.anchor, focus: coordinate };
      dragRef.current = next;
      setDragPreview(next);
    };

    const handleUp = () => {
      const final = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);
      clickHandledRef.current = true;
      if (final) selectRef.current(final);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const startEditing = (coordinate: string, initial?: string) => {
    skipBlurRef.current = false;
    setEditing({ coordinate, draft: initial ?? worksheet.cells[coordinate] ?? "" });
  };

  const selectSingle = (coordinate: string, extend: boolean) => {
    selectRef.current(extend
      ? { anchor: worksheet.selection.anchor, focus: coordinate }
      : { anchor: coordinate, focus: coordinate });
  };

  const moveSelection = (coordinate: string, rowDelta: number, columnDelta: number, extend: boolean) => {
    const position = parseCellCoordinate(coordinate);
    if (!position) return;
    const next = cellCoordinate(
      clamp(position.row + rowDelta, 0, worksheet.rowCount - 1),
      clamp(position.column + columnDelta, 0, worksheet.columnCount - 1),
    );
    selectSingle(next, extend);
    requestAnimationFrame(() => document.getElementById(cellDomId(worksheet.id, next))?.focus());
  };

  const finishEditing = (commit: boolean): Promise<unknown> => {
    const pending = editing;
    skipBlurRef.current = true;
    setEditing(null);
    if (!pending || !commit) return Promise.resolve();
    if (pending.draft === (worksheet.cells[pending.coordinate] ?? "")) return Promise.resolve();
    return onCommitCell(pending.coordinate, pending.draft);
  };

  const handleCellKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, coordinate: string) => {
    if (editing) return;
    switch (event.key) {
      case "ArrowUp": event.preventDefault(); moveSelection(coordinate, -1, 0, event.shiftKey); break;
      case "ArrowDown": event.preventDefault(); moveSelection(coordinate, 1, 0, event.shiftKey); break;
      case "ArrowLeft": event.preventDefault(); moveSelection(coordinate, 0, -1, event.shiftKey); break;
      case "ArrowRight": event.preventDefault(); moveSelection(coordinate, 0, 1, event.shiftKey); break;
      case "Enter":
      case "F2":
        event.preventDefault();
        startEditing(coordinate);
        break;
      default: {
        // Typing an ordinary character edits the cell directly, like a spreadsheet grid.
        const { key } = event;
        if (key.length === 1 && key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          startEditing(coordinate, key);
        }
        break;
      }
    }
  };

  const beginDrag = (coordinate: string, event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || editing) return;
    // Shift keeps the existing anchor, so shift-click and shift-drag extend the rectangle.
    const start = event.shiftKey
      ? { anchor: worksheet.selection.anchor, focus: coordinate }
      : { anchor: coordinate, focus: coordinate };
    dragRef.current = start;
    clickHandledRef.current = false;
    setDragPreview(start);
  };

  const openMenu = (target: MenuTarget, event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (target.kind === "cell" && !isCellInRange(normalizeRange(worksheet.selection), target.coordinate)) {
      // A right-click outside the current rectangle makes that cell the active one.
      selectRef.current({ anchor: target.coordinate, focus: target.coordinate });
    }
    setMenu({ target, x: event.clientX, y: event.clientY });
  };

  const closeMenu = (reason: "select" | "escape" | "outside") => {
    setMenu(null);
    if (reason !== "outside") {
      requestAnimationFrame(() => document.getElementById(cellDomId(worksheet.id, currentCell))?.focus());
    }
  };

  const menuLabel = !menu
    ? ""
    : menu.target.kind === "row"
      ? `Row ${menu.target.index + 1} options`
      : menu.target.kind === "column"
        ? `Column ${columnLabel(menu.target.index)} options`
        : `Cell ${menu.target.coordinate} options`;

  let menuItems: GridContextMenuItem[] = [];
  if (menu?.target.kind === "row") {
    const index = menu.target.index;
    menuItems = ROW_MENU_ACTIONS.map(({ action, label }) => ({
      id: action,
      label,
      onSelect: () => void onStructureChange({ kind: "row", action, index }),
    }));
  } else if (menu?.target.kind === "column") {
    const index = menu.target.index;
    menuItems = COLUMN_MENU_ACTIONS.map(({ action, label }) => ({
      id: action,
      label,
      onSelect: () => void onStructureChange({ kind: "column", action, index }),
    }));
  } else if (menu?.target.kind === "cell") {
    menuItems = [
      { id: "cut", label: "Cut", onSelect: () => onCopySelection("cut") },
      { id: "copy", label: "Copy", onSelect: () => onCopySelection("copy") },
      { id: "paste", label: "Paste", onSelect: () => onPasteFromClipboard() },
    ];
  }

  const isHeaderOpen = (kind: "row" | "column", index: number) =>
    menu?.target.kind === kind && menu.target.index === index;

  const isCellMenuOpen = (coordinate: string) =>
    menu?.target.kind === "cell" && menu.target.coordinate === coordinate;

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const target = event.target;
    // A paste inside the inline editor or a dialog field keeps the browser's own behaviour.
    if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    // An empty text is passed on as well: an in-application copy may have been unable to fill the
    // system clipboard (permission denied), and the page still knows its own copied rectangle.
    event.preventDefault();
    onPasteText(text);
  };

  const handleCopy = (event: ReactClipboardEvent<HTMLDivElement>, mode: "copy" | "cut") => {
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
    const text = onCopySelection(mode);
    if (text === null) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", text);
  };

  return (
    <div
      ref={gridRef}
      className="spreadsheet-grid"
      role="grid"
      aria-label="Worksheet grid"
      aria-multiselectable="true"
      data-worksheet={worksheet.name}
      onPaste={handlePaste}
      onCopy={(event) => handleCopy(event, "copy")}
      onCut={(event) => handleCopy(event, "cut")}
    >
      <div className="spreadsheet-grid__row spreadsheet-grid__row--header" role="row">
        <div className="spreadsheet-grid__cell spreadsheet-grid__corner" role="columnheader" aria-hidden="true" />
        {Array.from({ length: worksheet.columnCount }, (_, column) => (
          <div
            key={column}
            className="spreadsheet-grid__cell spreadsheet-grid__column-header"
            role="columnheader"
            aria-label={columnLabel(column)}
            aria-haspopup="menu"
            aria-expanded={isHeaderOpen("column", column)}
            onContextMenu={(event) => openMenu({ kind: "column", index: column }, event)}
          >
            {columnLabel(column)}
          </div>
        ))}
      </div>
      {Array.from({ length: worksheet.rowCount }, (_, row) => (
        <div className="spreadsheet-grid__row" role="row" key={row} hidden={hiddenRows.has(row)}>
          <div
            className="spreadsheet-grid__cell spreadsheet-grid__row-header"
            role="rowheader"
            aria-label={String(row + 1)}
            aria-haspopup="menu"
            aria-expanded={isHeaderOpen("row", row)}
            onContextMenu={(event) => openMenu({ kind: "row", index: row }, event)}
          >
            {row + 1}
          </div>
          {Array.from({ length: worksheet.columnCount }, (_, column) => {
            const coordinate = cellCoordinate(row, column);
            const selected = isCellInRange(range, coordinate);
            const isCurrent = coordinate === currentCell;
            const value = cellDisplayText(worksheet.cells[coordinate], results[coordinate]);
            const isEditing = editing?.coordinate === coordinate;
            const dropdown: DropdownRule | null = dropdownRules.length
              ? dropdownRuleAt(dropdownRules, coordinate)
              : null;
            const filterHeader = row === headerRow ? columnLabel(column) : "";
            const headerText = filterHeader ? value.trim() : "";
            return (
              <div
                key={coordinate}
                id={cellDomId(worksheet.id, coordinate)}
                role="gridcell"
                aria-label={coordinate}
                aria-selected={selected}
                data-cell-coordinate={coordinate}
                aria-haspopup="menu"
                aria-expanded={isCellMenuOpen(coordinate)}
                tabIndex={isCurrent ? 0 : -1}
                className={[
                  "spreadsheet-grid__cell",
                  selected ? "spreadsheet-grid__cell--selected" : "",
                  isCurrent ? "spreadsheet-grid__cell--current" : "",
                ].filter(Boolean).join(" ")}
                onMouseDown={(event) => beginDrag(coordinate, event)}
                onClick={(event) => {
                  // The rectangle is already committed on mouse-up; a bare programmatic click still
                  // selects, so the grid stays operable without pointer events.
                  if (clickHandledRef.current) {
                    clickHandledRef.current = false;
                    return;
                  }
                  selectSingle(coordinate, event.shiftKey);
                }}
                onDoubleClick={() => startEditing(coordinate)}
                onKeyDown={(event) => handleCellKeyDown(event, coordinate)}
                onContextMenu={(event) => openMenu({ kind: "cell", coordinate }, event)}
              >
                {isEditing ? (
                  <input
                    className="spreadsheet-grid__editor"
                    aria-label={`Edit ${coordinate}`}
                    value={editing.draft}
                    autoFocus
                    disabled={busy}
                    onChange={(event) => setEditing({ coordinate, draft: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void finishEditing(true);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        void finishEditing(false);
                      }
                    }}
                    onBlur={() => {
                      if (skipBlurRef.current) {
                        skipBlurRef.current = false;
                        return;
                      }
                      void finishEditing(true);
                    }}
                  />
                ) : (
                  <span className="spreadsheet-grid__value">{value}</span>
                )}
                {!isEditing && dropdown ? (
                  <CellDropdown
                    coordinate={coordinate}
                    values={dropdown.values}
                    currentValue={worksheet.cells[coordinate] ?? ""}
                    disabled={busy}
                    onSelect={(next) => void onCommitCell(coordinate, next)}
                  />
                ) : null}
                {!isEditing && headerText !== "" ? (
                  <button
                    type="button"
                    className="spreadsheet-grid__filter"
                    aria-label={`Filter ${headerText}`}
                    aria-haspopup="dialog"
                    aria-expanded={openFilterColumn === filterHeader}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFilter(filterHeader, headerText);
                    }}
                  >
                    <span aria-hidden="true" className="spreadsheet-grid__filter-caret" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      {menu ? (
        <GridContextMenu
          label={menuLabel}
          position={{ x: menu.x, y: menu.y }}
          items={menuItems}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
