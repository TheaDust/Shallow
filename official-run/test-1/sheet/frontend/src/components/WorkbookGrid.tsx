import { useEffect, useRef, useState } from "react";
import { columnLabel, cellCoordinate, isInRegion } from "../coords";
import WorksheetMenu from "./WorksheetMenu";

export { columnLabel, cellCoordinate, isInRegion };

const COLUMNS = 20; // A..T
const ROWS = 50;

export interface WorkbookGridProps {
  /** Computed display values: formula cells show their current result. */
  displayCells: Record<string, string>;
  selection: { current: string; end: string };
  /** Single-click selection (commit pending edits, persist the new selection). */
  onSelectCell: (coord: string) => void;
  /** Drag started on a cell (left-button mousedown). */
  onSelectRangeStart?: (coord: string) => void;
  /** Drag extended to another cell while the button is held. */
  onSelectRangeExtend?: (current: string, end: string) => void;
  /** Drag finished (mouseup); persist the complete rectangle. */
  onSelectRangeCommit?: (current: string, end: string) => void;
  /** Double-click a cell: open the inline editor for it. */
  onEditCell?: (coord: string) => void;
  editingCoord?: string | null;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditCommit?: () => void;
  onEditCancel?: () => void;
  /** Declared used-range size of the sheet; the grid expands beyond the default. */
  dimensions?: { rows: number; columns: number };
  /** Row-number menu actions (REQ-2-2-1); when absent the menu is disabled. */
  onInsertRowAbove?: (row: number) => void;
  onInsertRowBelow?: (row: number) => void;
  onDeleteRow?: (row: number) => void;
  /** Column-header menu actions (REQ-2-2-2); when absent the menu is disabled. */
  onInsertColumnLeft?: (column: number) => void;
  onInsertColumnRight?: (column: number) => void;
  onDeleteColumn?: (column: number) => void;
  /** Right-click a cell: select it (unless inside the selection) and open the cell context menu (REQ-3-1-2 / REQ-3-2-1). */
  onContextMenuCell?: (coord: string) => void;
  /** Cell context-menu action: paste the external clipboard at the selection. */
  onPaste?: () => void;
  /** Cell context-menu action: copy the selected rectangle (REQ-3-2-1). */
  onCopy?: () => void;
  /** Cell context-menu action: cut the selected rectangle (REQ-3-2-1). */
  onCut?: () => void;
}

export default function WorkbookGrid({
  displayCells,
  selection,
  onSelectCell,
  onSelectRangeStart,
  onSelectRangeExtend,
  onSelectRangeCommit,
  onEditCell,
  editingCoord,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
  dimensions,
  onInsertRowAbove,
  onInsertRowBelow,
  onDeleteRow,
  onInsertColumnLeft,
  onInsertColumnRight,
  onDeleteColumn,
  onContextMenuCell,
  onPaste,
  onCopy,
  onCut,
}: WorkbookGridProps) {
  const { current, end } = selection;
  const columns = Math.max(COLUMNS, dimensions?.columns ?? 0);
  const rows = Math.max(ROWS, dimensions?.rows ?? 0);
  const [menuRow, setMenuRow] = useState<number | null>(null);
  const [menuColumn, setMenuColumn] = useState<number | null>(null);
  const [cellMenu, setCellMenu] = useState<{ coord: string; x: number; y: number } | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const rowHeaderRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const columnHeaderRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hasRowMenu = Boolean(onInsertRowAbove || onInsertRowBelow || onDeleteRow);
  const hasColumnMenu = Boolean(onInsertColumnLeft || onInsertColumnRight || onDeleteColumn);

  // Drag selection: track the anchor while the left button is held down.
  const drag = useRef<{ anchor: string; current: string; active: boolean; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);

  useEffect(() => {
    function onWindowMouseUp() {
      const d = drag.current;
      if (!d || !d.active) return;
      d.active = false;
      drag.current = null;
      if (d.moved) {
        suppressClick.current = true;
        onSelectRangeCommit?.(d.anchor, d.current);
      }
    }
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, [onSelectRangeCommit]);

  function startDrag(coord: string) {
    // A drag begins: clear any pending click-suppression from an earlier drag.
    suppressClick.current = false;
    drag.current = { anchor: coord, current: coord, active: true, moved: false };
    onSelectRangeStart?.(coord);
  }

  function extendDrag(coord: string) {
    const d = drag.current;
    if (!d || !d.active || coord === d.anchor) return;
    d.moved = true;
    d.current = coord;
    onSelectRangeExtend?.(d.anchor, coord);
  }

  function handleClick(coord: string) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSelectCell(coord);
  }

  function closeRowMenu() {
    const open = menuRow;
    setMenuRow(null);
    if (open != null) rowHeaderRefs.current[open]?.focus();
  }

  function closeColumnMenu() {
    const open = menuColumn;
    setMenuColumn(null);
    if (open != null) columnHeaderRefs.current[open]?.focus();
  }

  function openCellMenu(e: React.MouseEvent, coord: string) {
    if (!onPaste && !onCopy && !onCut) return;
    e.preventDefault();
    onContextMenuCell?.(coord);
    const el = gridScrollRef.current;
    const rect = el?.getBoundingClientRect();
    setCellMenu({
      coord,
      x: e.clientX - (rect?.left ?? 0) + (el?.scrollLeft ?? 0),
      y: e.clientY - (rect?.top ?? 0) + (el?.scrollTop ?? 0),
    });
  }

  function closeCellMenu() {
    setCellMenu(null);
  }

  const headerCells = [];
  for (let c = 0; c < columns; c += 1) {
    const columnNumber = c + 1;
    headerCells.push(
      <div
        key={columnLabel(c)}
        className="column-header-cell"
        ref={(el) => {
          columnHeaderRefs.current[columnNumber] = el;
        }}
        onContextMenu={(e) => {
          if (!hasColumnMenu) return;
          e.preventDefault();
          setMenuColumn(menuColumn === columnNumber ? null : columnNumber);
        }}
      >
        <div role="columnheader" aria-label={columnLabel(c)}>
          {columnLabel(c)}
        </div>
        {hasColumnMenu && menuColumn === columnNumber && (
          <WorksheetMenu
            items={[
              { label: "Insert 1 column left", onSelect: () => onInsertColumnLeft?.(columnNumber) },
              { label: "Insert 1 column right", onSelect: () => onInsertColumnRight?.(columnNumber) },
              { label: "Delete column", onSelect: () => onDeleteColumn?.(columnNumber) },
            ]}
            onClose={closeColumnMenu}
          />
        )}
      </div>,
    );
  }

  const bodyRows = [];
  for (let r = 0; r < rows; r += 1) {
    const rowNumber = r + 1;
    const rowCells = [];
    for (let c = 0; c < columns; c += 1) {
      const coord = cellCoordinate(c, r);
      const selected = isInRegion(coord, current, end);
      const editing = editingCoord === coord;
      rowCells.push(
        <div
          key={coord}
          role="gridcell"
          aria-label={coord}
          aria-selected={selected}
          className={selected ? "cell selected" : "cell"}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).tagName === "INPUT") return;
            startDrag(coord);
          }}
          onMouseOver={() => extendDrag(coord)}
          onClick={() => handleClick(coord)}
          onDoubleClick={() => onEditCell?.(coord)}
          onContextMenu={(e) => openCellMenu(e, coord)}
        >
          {editing ? (
            <input
              className="cell-editor"
              aria-label={`Edit ${coord}`}
              value={editValue ?? ""}
              onChange={(e) => onEditChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onEditCommit?.();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onEditCancel?.();
                }
              }}
              onBlur={() => onEditCommit?.()}
              autoFocus
            />
          ) : (
            displayCells[coord] ?? ""
          )}
        </div>,
      );
    }
    bodyRows.push(
      <div key={rowNumber} role="row" className="grid-row">
        <div
          className="row-header-cell"
          ref={(el) => {
            rowHeaderRefs.current[rowNumber] = el;
          }}
          onContextMenu={(e) => {
            if (!hasRowMenu) return;
            e.preventDefault();
            setMenuRow(menuRow === rowNumber ? null : rowNumber);
          }}
        >
          <div role="rowheader" aria-label={String(rowNumber)}>
            {rowNumber}
          </div>
          {hasRowMenu && menuRow === rowNumber && (
            <WorksheetMenu
              items={[
                { label: "Insert 1 row above", onSelect: () => onInsertRowAbove?.(rowNumber) },
                { label: "Insert 1 row below", onSelect: () => onInsertRowBelow?.(rowNumber) },
                { label: "Delete row", onSelect: () => onDeleteRow?.(rowNumber) },
              ]}
              onClose={closeRowMenu}
            />
          )}
        </div>
        {rowCells}
      </div>,
    );
  }

  return (
    <div className="grid-scroll" ref={gridScrollRef}>
      <div role="grid" aria-label="Worksheet grid" aria-multiselectable="true" className="worksheet-grid">
        <div role="row" className="grid-row header-row">
          <div className="corner" aria-hidden="true" />
          {headerCells}
        </div>
        {bodyRows}
      </div>
      {cellMenu && (
        <div className="cell-menu-anchor" style={{ left: cellMenu.x, top: cellMenu.y }}>
          <WorksheetMenu
            items={[
              { label: "Cut", onSelect: () => onCut?.() },
              { label: "Copy", onSelect: () => onCopy?.() },
              { label: "Paste", onSelect: () => onPaste?.() },
            ]}
            onClose={closeCellMenu}
          />
        </div>
      )}
    </div>
  );
}
