import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import type { Worksheet, WorksheetFreeze, WorksheetSelection } from "../domain/types";
import { computeDisplayValues, type FormulaContext } from "../domain/formula";
import { conditionalFill } from "../domain/conditional";
import { filterRegion, hiddenRows } from "../domain/filter";
import { DROPDOWN_TYPE, dropdownValues, findRuleForCoordinate } from "../domain/validation";
import {
  cellName,
  columnName,
  isInsideRegion,
  parseCellName,
  regionBetween,
  usedExtent,
  type CellRegion,
} from "../domain/grid";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import type { StructureAxis, StructureMode } from "../lib/workbook-api";

export type { WorksheetSelection };

export type StructureDirection = "before" | "after";

export interface WorksheetGridProps {
  worksheet: Worksheet;
  selection: WorksheetSelection;
  rowCount?: number;
  columnCount?: number;
  /** Frozen panes of the worksheet; absent or zero means nothing is frozen. */
  freeze?: WorksheetFreeze | null;
  /** Named ranges of the workbook, so a formula can use one as a range reference. */
  formulaContext?: FormulaContext;
  /** Live rectangle update while selecting (not yet persisted). */
  onSelectRange(anchor: string, focus: string): void;
  /** Persist the finished rectangle after a click or drag. */
  onSelectionCommit(anchor: string, focus: string): void;
  /** Commit an inline grid edit for one cell. */
  onEditCell(coordinate: string, value: string): void;
  /** Clear every cell of the current selected rectangle (the Delete key). */
  onClearSelection?(): void;
  /** True while the editor holds an internal copied or cut range. */
  clipboardFilled: boolean;
  /** Paste the external clipboard text (already read) starting at `start`. */
  onPaste(start: string, text: string): void;
  /** Request a paste at `start` from the internal range or the system clipboard. */
  onPasteCommand(start: string): void;
  /** Copy the current selection into the internal clipboard. */
  onCopy(): void;
  /** Cut the current selection into the internal clipboard. */
  onCut(): void;
  onUndo(): void;
  onRedo(): void;
  onInsert(axis: StructureAxis, index: number, direction: StructureDirection): void;
  onDelete(axis: StructureAxis, index: number): void;
  /** Open the filter dialog of one header cell of the worksheet's filter view. */
  onFilter?(column: number, header: string): void;
  /** Open the note of one cell; only cells with a stored note expose the button. */
  onOpenNote?(coordinate: string): void;
}

export const DEFAULT_ROW_COUNT = 20;
export const DEFAULT_COLUMN_COUNT = 12;
/**
 * Fixed widths of the frozen panes, mirrored in `styles.css`. Fixed columns
 * keep the `left` offset of every frozen column exact, so the panes stay
 * aligned while the rest of the grid scrolls horizontally.
 */
export const HEADER_COLUMN_REM = 3;
export const DATA_COLUMN_REM = 6;

const ROW_COMMANDS = [
  { id: "insert-above", label: "Insert 1 row above", mode: "insert-before" as StructureMode },
  { id: "insert-below", label: "Insert 1 row below", mode: "insert-after" as StructureMode },
  { id: "delete", label: "Delete row", mode: "delete" as StructureMode },
];

const COLUMN_COMMANDS = [
  { id: "insert-left", label: "Insert 1 column left", mode: "insert-before" as StructureMode },
  { id: "insert-right", label: "Insert 1 column right", mode: "insert-after" as StructureMode },
  { id: "delete", label: "Delete column", mode: "delete" as StructureMode },
];

interface EditingCell {
  coordinate: string;
  draft: string;
}

interface OpenMenu {
  label: string;
  items: ContextMenuItem[];
  x: number;
  y: number;
}

/**
 * True when a Delete press belongs to the grid: the event was raised inside it
 * or the focused element is, or nothing focusable owns the keyboard (a press
 * right after a page-level click). A press on a text field is handled by the
 * caller and never clears cells.
 */
function deleteBelongsToGrid(grid: HTMLDivElement | null, target: EventTarget | null): boolean {
  if (!grid) return false;
  const inside = (node: EventTarget | null): boolean => node instanceof Node && (node === grid || grid.contains(node));
  if (inside(target)) return true;
  const active = document.activeElement;
  if (inside(active)) return true;
  return active === null || active === document.body || active === document.documentElement;
}

export function WorksheetGrid({
  worksheet,
  selection,
  rowCount = DEFAULT_ROW_COUNT,
  columnCount = DEFAULT_COLUMN_COUNT,
  freeze,
  formulaContext,
  onSelectRange,
  onSelectionCommit,
  onEditCell,
  onClearSelection,
  clipboardFilled,
  onPaste,
  onPasteCommand,
  onCopy,
  onCut,
  onUndo,
  onRedo,
  onInsert,
  onDelete,
  onFilter,
  onOpenNote,
}: WorksheetGridProps) {
  const region: CellRegion = regionBetween(selection.anchor, selection.focus);
  // The grid shows at least the default sheet and grows to every cell the
  // worksheet uses, so seeded data rows (and a scrollable frozen pane) stay
  // reachable.
  const extent = useMemo(() => usedExtent(worksheet.cells), [worksheet.cells]);
  const rowTotal = Math.max(rowCount, extent.rows);
  const columnTotal = Math.max(columnCount, extent.columns);
  const frozenRows = Math.max(0, Math.min(freeze?.rows ?? 0, rowTotal));
  const frozenColumns = Math.max(0, Math.min(freeze?.columns ?? 0, columnTotal));
  const rows = Array.from({ length: rowTotal }, (_, index) => index + 1);
  const columns = Array.from({ length: columnTotal }, (_, index) => index + 1);
  const rowTemplate: CSSProperties = {
    gridTemplateColumns: `${HEADER_COLUMN_REM}rem repeat(${columnTotal}, ${DATA_COLUMN_REM}rem)`,
  };
  /**
   * Horizontal offset that keeps one cell inside the frozen columns. Column 0
   * is the row-number heading, which stays left as soon as one column is
   * frozen; a column outside the frozen pane needs no offset at all.
   */
  const frozenLeft = (column: number): CSSProperties | undefined => {
    if (frozenColumns < 1) return undefined;
    if (column === 0) return { left: "0rem" };
    if (column > frozenColumns) return undefined;
    return { left: `${HEADER_COLUMN_REM + (column - 1) * DATA_COLUMN_REM}rem` };
  };
  /** Marks a heading or data cell as part of the frozen left pane. */
  const frozenPaneClass = (column: number): string =>
    frozenColumns >= 1 && column <= frozenColumns ? " worksheet-grid__cell--frozen-left" : "";
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  /** Coordinate of the open validation-dropdown list, or `null`. */
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  // Formula cells display their calculated result while the formula bar and
  // inline editor keep the original expression.
  const values = useMemo(
    () => computeDisplayValues(worksheet.cells, formulaContext),
    [worksheet.cells, formulaContext],
  );
  // Filter rules only hide rows: the underlying cells and their order stay put.
  const hidden = useMemo(() => hiddenRows(values, worksheet.filter), [values, worksheet.filter]);
  const filtered = filterRegion(worksheet.filter);

  const editingRef = useRef<EditingCell | null>(null);
  const dragRef = useRef<WorksheetSelection | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const regionRef = useRef(region);
  regionRef.current = region;
  const clipboardFilledRef = useRef(clipboardFilled);
  clipboardFilledRef.current = clipboardFilled;
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;
  const onPasteCommandRef = useRef(onPasteCommand);
  onPasteCommandRef.current = onPasteCommand;
  const onCopyRef = useRef(onCopy);
  onCopyRef.current = onCopy;
  const onCutRef = useRef(onCut);
  onCutRef.current = onCut;
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;
  const onSelectionCommitRef = useRef(onSelectionCommit);
  onSelectionCommitRef.current = onSelectionCommit;
  const onFilterRef = useRef(onFilter);
  onFilterRef.current = onFilter;
  const onOpenNoteRef = useRef(onOpenNote);
  onOpenNoteRef.current = onOpenNote;
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;

  // A pointer press on a cell starts a selection rectangle; releasing the
  // pointer anywhere persists the finished rectangle.
  useEffect(() => {
    const finish = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      onSelectionCommitRef.current(drag.anchor, drag.focus);
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, []);

  // Ctrl+V pastes into the current selection: the editor's internal copied or
  // cut range when one exists, otherwise the external clipboard. Events raised
  // inside a text field (formula bar, inline editor, dialogs) keep their default
  // text behaviour.
  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const filled = clipboardFilledRef.current;
      const text = filled ? "" : event.clipboardData?.getData("text/plain") ?? "";
      if (!filled && !text) return;
      event.preventDefault();
      const current = selectionRef.current;
      const start = regionBetween(current.anchor, current.focus);
      onPasteRef.current(cellName(start.top, start.left), text);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, []);

  // Grid-level shortcuts: Ctrl/Cmd+C copies and Ctrl/Cmd+X cuts the selected
  // rectangle, Ctrl+Z undoes and Ctrl+Y (or Ctrl+Shift+Z) redoes. Delete clears
  // the selected rectangle while the grid owns the keyboard. They are ignored
  // while a text field owns the focus, where the browser keeps its native text
  // editing behaviour (Delete removes a character there).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "Delete") {
        if (!deleteBelongsToGrid(gridRef.current, target)) return;
        event.preventDefault();
        onClearSelectionRef.current?.();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        onCopyRef.current();
      } else if (key === "x") {
        event.preventDefault();
        onCutRef.current();
      } else if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        onUndoRef.current();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        onRedoRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const startEdit = (coordinate: string) => {
    const next = { coordinate, draft: worksheet.cells[coordinate] ?? "" };
    editingRef.current = next;
    setEditing(next);
  };

  const commitEdit = () => {
    const current = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (current) onEditCell(current.coordinate, current.draft);
  };

  const cancelEdit = () => {
    editingRef.current = null;
    setEditing(null);
  };

  const changeEdit = (draft: string) => {
    const current = editingRef.current;
    if (!current) return;
    const next = { coordinate: current.coordinate, draft };
    editingRef.current = next;
    setEditing(next);
  };

  const handleCellMouseDown = (coordinate: string) => (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Presses inside the inline editor or on a cell button keep their own
    // behaviour (text editing, opening the validation dropdown, filtering).
    if (target.tagName === "INPUT" || target.closest("button")) return;
    if (editingRef.current && editingRef.current.coordinate !== coordinate) commitEdit();
    event.preventDefault();
    // Move focus off any text field (formula bar, dialog) so keyboard actions
    // such as Ctrl+V target the grid; this also commits a formula-bar draft.
    gridRef.current?.focus({ preventScroll: true });
    // A shift press extends the rectangle from the current anchor instead of
    // starting a new one, which is how a range is selected without dragging.
    const anchor = event.shiftKey ? selectionRef.current.anchor : coordinate;
    onSelectRange(anchor, coordinate);
    // Only the primary button starts a drag. A context-menu press must not
    // extend the rectangle when the pointer drifts (for example while the menu
    // opening scrolls the grid), so it never records a drag anchor.
    dragRef.current = event.button === 0 ? { anchor, focus: coordinate } : null;
  };

  const handleCellMouseEnter = (coordinate: string) => (event: MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.buttons !== 1 || drag.focus === coordinate) return;
    drag.focus = coordinate;
    onSelectRange(drag.anchor, coordinate);
  };

  const openHeaderMenu = (axis: StructureAxis, index: number) => (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const commands = axis === "row" ? ROW_COMMANDS : COLUMN_COMMANDS;
    setMenu({
      label: axis === "row" ? `Row ${index} menu` : `Column ${columnName(index)} menu`,
      items: commands.map((command) => ({
        id: command.id,
        label: command.label,
        onSelect: () => {
          if (command.mode === "delete") onDelete(axis, index);
          else onInsert(axis, index, command.mode === "insert-before" ? "before" : "after");
        },
      })),
      x: event.clientX,
      y: event.clientY,
    });
  };

  const openCellMenu = (coordinate: string) => (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Pressing inside the current rectangle keeps the whole selection so range
    // commands act on it; pressing elsewhere selects the pressed cell first.
    const position = parseCellName(coordinate);
    if (!position || !isInsideRegion(position.row, position.column, regionRef.current)) {
      onSelectRange(coordinate, coordinate);
    }
    setMenu({
      label: `Cell ${coordinate} menu`,
      items: [
        { id: "copy", label: "Copy", onSelect: () => onCopyRef.current() },
        { id: "cut", label: "Cut", onSelect: () => onCutRef.current() },
        { id: "paste", label: "Paste", onSelect: () => onPasteCommandRef.current(coordinate) },
      ],
      x: event.clientX,
      y: event.clientY,
    });
  };

  /** The row of column letters, pinned above the scrolling rows. */
  const renderColumnHeadings = () => (
    <div role="row" className="worksheet-grid__row worksheet-grid__row--header" style={rowTemplate}>
      <div
        role="columnheader"
        aria-label="Row numbers"
        className={`worksheet-grid__cell worksheet-grid__cell--corner${frozenPaneClass(0)}`}
        style={frozenLeft(0)}
      />
      {columns.map((column) => (
        <div
          key={column}
          role="columnheader"
          aria-label={columnName(column)}
          className={`worksheet-grid__cell worksheet-grid__cell--column${frozenPaneClass(column)}`}
          style={frozenLeft(column)}
          onContextMenu={openHeaderMenu("column", column)}
        >
          {columnName(column)}
        </div>
      ))}
    </div>
  );

  const renderRow = (row: number) => (
    <div role="row" key={row} className="worksheet-grid__row" style={rowTemplate}>
      <div
        role="rowheader"
        aria-label={String(row)}
        className={`worksheet-grid__cell worksheet-grid__cell--row${frozenPaneClass(0)}`}
        style={frozenLeft(0)}
        onContextMenu={openHeaderMenu("row", row)}
      >
        {row}
      </div>
      {columns.map((column) => {
        const coordinate = cellName(row, column);
        const selected = isInsideRegion(row, column, region);
        const isEditing = editing?.coordinate === coordinate;
        const headerText =
          filtered && filtered.top === row && column >= filtered.left && column <= filtered.right
            ? values[coordinate] ?? ""
            : "";
        const cellRule = findRuleForCoordinate(worksheet.validationRules, coordinate);
        const dropdownRule = cellRule && cellRule.type === DROPDOWN_TYPE ? cellRule : null;
        const frozen = column <= frozenColumns;
        // A rule that matches this cell paints it with its visible fill; a cell
        // without a match keeps the plain background of the grid.
        const fill = conditionalFill(worksheet.conditionalFormats, row, column, values[coordinate]);
        const cellStyle: CSSProperties = { ...frozenLeft(column) };
        if (fill) cellStyle.backgroundColor = fill;
        return (
          <div
            key={coordinate}
            role="gridcell"
            aria-label={coordinate}
            aria-selected={selected}
            className={`worksheet-grid__cell worksheet-grid__cell--data${selected ? " is-selected" : ""}${
              isEditing ? " is-editing" : ""
            }${frozen ? " worksheet-grid__cell--frozen-left" : ""}`}
            data-cell={coordinate}
            style={cellStyle}
            onMouseDown={handleCellMouseDown(coordinate)}
            onMouseOver={handleCellMouseEnter(coordinate)}
            onDoubleClick={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              startEdit(coordinate);
            }}
            onContextMenu={openCellMenu(coordinate)}
          >
                {isEditing ? (
                  <input
                    className="worksheet-grid__editor"
                    type="text"
                    aria-label={`Edit ${coordinate}`}
                    value={editing.draft}
                    autoFocus
                    onChange={(event) => changeEdit(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitEdit();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onBlur={commitEdit}
                  />
                ) : (
                  values[coordinate] ?? ""
                )}
                {!isEditing && headerText !== "" ? (
                  <button
                    type="button"
                    className="worksheet-grid__filter"
                    aria-label={`Filter ${headerText}`}
                    aria-haspopup="dialog"
                    onClick={() => onFilterRef.current?.(column, headerText)}
                  >
                    <span aria-hidden="true" className="worksheet-grid__arrow" />
                  </button>
                ) : null}
                {!isEditing && worksheet.notes?.[coordinate] ? (
                  <button
                    type="button"
                    className="worksheet-grid__note"
                    aria-label={`Open note for ${coordinate}`}
                    aria-haspopup="dialog"
                    onClick={() => onOpenNoteRef.current?.(coordinate)}
                  >
                    <span aria-hidden="true" className="worksheet-grid__note-mark" />
                  </button>
                ) : null}
                {!isEditing && dropdownRule ? (
                  <div
                    className="worksheet-grid__dropdown"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setOpenDropdown(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setOpenDropdown(null);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="worksheet-grid__dropdown-button"
                      aria-label={`Open dropdown for ${coordinate}`}
                      aria-haspopup="listbox"
                      aria-expanded={openDropdown === coordinate}
                      onClick={() => setOpenDropdown(openDropdown === coordinate ? null : coordinate)}
                    >
                      <span aria-hidden="true" className="worksheet-grid__arrow" />
                    </button>
                    {openDropdown === coordinate ? (
                      <div
                        role="listbox"
                        aria-label={`Allowed values for ${coordinate}`}
                        className="worksheet-grid__listbox"
                      >
                        {dropdownValues(dropdownRule).map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="option"
                            className="worksheet-grid__option"
                            aria-selected={(values[coordinate] ?? "") === value}
                            onClick={() => {
                              setOpenDropdown(null);
                              onEditCell(coordinate, value);
                            }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
  );

  // The column headings and the frozen rows stick to the top of the grid's
  // scroll area, while rows hidden by a filter view stay out of both groups.
  const frozenRowNumbers = rows.filter((row) => row <= frozenRows && !hidden.has(row));
  const scrollingRowNumbers = rows.filter((row) => row > frozenRows && !hidden.has(row));

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="Worksheet grid"
      aria-multiselectable="true"
      tabIndex={-1}
      className="worksheet-grid"
    >
      <div role="rowgroup" className="worksheet-grid__pane">
        {renderColumnHeadings()}
        {frozenRowNumbers.map(renderRow)}
      </div>
      <div role="rowgroup">{scrollingRowNumbers.map(renderRow)}</div>
      {menu ? (
        <ContextMenu label={menu.label} items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}
