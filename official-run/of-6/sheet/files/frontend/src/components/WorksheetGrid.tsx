import { memo, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent } from 'react';
import type { FilterView, Sheet } from '../types';
import { cellToCoordinate, columnLetter, coordinateToCell } from '../gridUtils';
import { evaluateFormula, formatFormulaValue } from '../formula';
import { isFilterHeaderCell, rowIsFilteredOut } from '../filter';
import { dropdownValuesForCoord } from '../rowColOps';

export interface GridSelection {
  anchor: string;
  active: string;
}

export type RowMenuAction = 'above' | 'below' | 'delete';

export type ColMenuAction = 'left' | 'right' | 'delete';

interface WorksheetGridProps {
  sheet: Sheet;
  selection: GridSelection;
  filter: FilterView | null;
  onOpenHeaderFilter: (column: number) => void;
  rowMenuRow: number | null;
  onRowHeaderMenu: (row: number) => void;
  onRowMenuAction: (action: RowMenuAction, row: number) => void;
  onRowMenuKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  colMenuCol: number | null;
  onColHeaderMenu: (col: number) => void;
  onColMenuAction: (action: ColMenuAction, col: number) => void;
  onColMenuKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onCellActivate: (coord: string) => void;
  onCellDrag: (coord: string) => void;
  onCellValueChange: (coord: string, value: string) => void;
  onRevertCell: (coord: string) => void;
  onEditStart: (coord: string, value: string) => void;
  onMoveSelection: (deltaRow: number, deltaColumn: number, extend: boolean) => void;
  onCommitMove: (deltaRow: number, deltaColumn: number) => void;
  onPasteText: (text: string, startCoord: string) => void;
  onMenuPaste: (coord: string) => void;
  onCopyRange: (event: ReactClipboardEvent<HTMLDivElement>, kind: 'copy' | 'cut') => void;
  onMenuCopyRange: (kind: 'copy' | 'cut') => void;
}

function isInRegion(coord: string, anchor: string, active: string): boolean {
  const a = cellToCoordinate(anchor);
  const b = cellToCoordinate(active);
  const c = cellToCoordinate(coord);
  if (!a || !b || !c) {
    return false;
  }
  const minRow = Math.min(a.row, b.row);
  const maxRow = Math.max(a.row, b.row);
  const minCol = Math.min(a.column, b.column);
  const maxCol = Math.max(a.column, b.column);
  return c.row >= minRow && c.row <= maxRow && c.column >= minCol && c.column <= maxCol;
}

export function cellDisplayValue(raw: string, cells: Sheet['cells'], coord?: string): string {
  if (!raw.startsWith('=')) {
    return raw;
  }
  try {
    // The cell's own coordinate seeds the reference chain so a direct or
    // indirect circular reference is reported as #REF! instead of recursing.
    return formatFormulaValue(evaluateFormula(raw, cells, 0, coord ? [coord] : []));
  } catch {
    return raw;
  }
}



interface CellProps {
  coord: string;
  value: string;
  display: string;
  selected: boolean;
  editDraft: string | null;
  filterButtonLabel: string | null;
  dropdownValues: string[] | null;
  dropdownOpen: boolean;
  onToggleDropdown: () => void;
  onSelectDropdownValue: (value: string) => void;
  onDropdownKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onOpenFilter: () => void;
  onActivate: () => void;
  onDrag: () => void;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onEditStart: (value: string) => void;
  onDoubleClick: () => void;
  onEditDraftChange: (value: string) => void;
  onEditDraftKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onEditDraftBlur: () => void;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onMenuCopy: (kind: 'copy' | 'cut') => void;
  onMenuPaste: () => void;
  onMenuKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

const GridCell = memo(function GridCell({
  coord,
  value,
  display,
  selected,
  editDraft,
  filterButtonLabel,
  dropdownValues,
  dropdownOpen,
  onToggleDropdown,
  onSelectDropdownValue,
  onDropdownKeyDown,
  onOpenFilter,
  onActivate,
  onDrag,
  onChange,
  onKeyDown,
  onEditStart,
  onDoubleClick,
  onEditDraftChange,
  onEditDraftKeyDown,
  onEditDraftBlur,
  menuOpen,
  onOpenMenu,
  onMenuCopy,
  onMenuPaste,
  onMenuKeyDown,
}: CellProps) {
  const colIndex = cellToCoordinate(coord)?.column ?? 0;
  return (
    <div
      role="gridcell"
      aria-label={coord}
      aria-selected={selected ? 'true' : 'false'}
      aria-colindex={colIndex + 1}
      data-coord={coord}
      className={'grid-cell' + (selected ? ' selected' : '')}
      onMouseDown={() => {
        onActivate();
      }}
      onMouseEnter={onDrag}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu();
      }}
    >
      <span className="cell-display">{display}</span>
      {filterButtonLabel !== null && (
        <button
          type="button"
          className="header-filter-button"
          aria-label={filterButtonLabel}
          data-header-filter={colIndex}
          onClick={onOpenFilter}
        >
          <span aria-hidden="true">▾</span>
        </button>
      )}
      {dropdownValues !== null && (
        <>
          <button
            type="button"
            className="cell-dropdown-button"
            aria-label={`Open dropdown for ${coord}`}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen ? 'true' : 'false'}
            data-cell-dropdown={coord}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onToggleDropdown}
          >
            <span aria-hidden="true">▾</span>
          </button>
          {dropdownOpen && (
            <div
              role="listbox"
              aria-label={`Options for ${coord}`}
              className="cell-dropdown-list"
              data-cell-dropdown={coord}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {dropdownValues.map((optionValue, index) => (
                <div
                  key={optionValue}
                  role="option"
                  aria-selected={value.trim() === optionValue ? 'true' : 'false'}
                  tabIndex={index === 0 ? 0 : -1}
                  className="cell-dropdown-option"
                  data-dropdown-option
                  onClick={() => onSelectDropdownValue(optionValue)}
                  onKeyDown={onDropdownKeyDown}
                >
                  {optionValue}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <input
        aria-label={coord}
        className="cell-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          // Mouse selection is handled by the gridcell mousedown; programmatic
          // focus (keyboard navigation) must keep the existing selection.
          onEditStart(value);
        }}
      />
      {editDraft !== null && (
        <input
          aria-label={`Edit ${coord}`}
          className="cell-edit-input"
          value={editDraft}
          autoFocus
          onChange={(event) => onEditDraftChange(event.target.value)}
          onKeyDown={onEditDraftKeyDown}
          onBlur={onEditDraftBlur}
        />
      )}
      {menuOpen && (
        <div
          role="menu"
          aria-label={`Options for ${coord}`}
          className="cell-menu"
          data-cell-menu={coord}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="cell-menu-item"
            data-cell-menu-item
            autoFocus
            onClick={() => onMenuCopy('copy')}
            onKeyDown={onMenuKeyDown}
          >
            Copy
          </button>
          <button
            type="button"
            role="menuitem"
            className="cell-menu-item"
            data-cell-menu-item
            onClick={() => onMenuCopy('cut')}
            onKeyDown={onMenuKeyDown}
          >
            Cut
          </button>
          <button
            type="button"
            role="menuitem"
            className="cell-menu-item"
            data-cell-menu-item
            onClick={() => onMenuPaste()}
            onKeyDown={onMenuKeyDown}
          >
            Paste
          </button>
        </div>
      )}
    </div>
  );
});

export default function WorksheetGrid({
  sheet,
  selection,
  filter,
  onOpenHeaderFilter,
  rowMenuRow,
  onRowHeaderMenu,
  onRowMenuAction,
  onRowMenuKeyDown,
  colMenuCol,
  onColHeaderMenu,
  onColMenuAction,
  onColMenuKeyDown,
  onCellActivate,
  onCellDrag,
  onCellValueChange,
  onRevertCell,
  onEditStart,
  onMoveSelection,
  onCommitMove,
  onPasteText,
  onMenuPaste,
  onCopyRange,
  onMenuCopyRange,
}: WorksheetGridProps) {
  const { rowCount, columnCount, cells } = sheet;

  const [editCell, setEditCell] = useState<{ coord: string; draft: string } | null>(null);
  const editCellRef = useRef<{ coord: string; draft: string } | null>(null);
  editCellRef.current = editCell;

  const [cellMenuCoord, setCellMenuCoord] = useState<string | null>(null);
  const [dropdownOpenCoord, setDropdownOpenCoord] = useState<string | null>(null);

  // Switching worksheets must not leak local editing/menu/dropdown UI state
  // from the source worksheet into the target worksheet (REQ-2-1-2). A blur
  // normally commits the draft before the tab click, so this effect only
  // clears state that is still open when the sheet changes.
  const sheetIdRef = useRef(sheet.id);
  useEffect(() => {
    if (sheetIdRef.current !== sheet.id) {
      sheetIdRef.current = sheet.id;
      setEditCell(null);
      editCellRef.current = null;
      setCellMenuCoord(null);
      setDropdownOpenCoord(null);
    }
  }, [sheet.id]);

  useEffect(() => {
    if (cellMenuCoord === null && dropdownOpenCoord === null) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (
        target.closest('[data-cell-menu]') ||
        target.closest('[data-cell-dropdown]')
      ) {
        return;
      }
      setCellMenuCoord(null);
      setDropdownOpenCoord(null);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [cellMenuCoord, dropdownOpenCoord]);

  function closeCellMenu() {
    setCellMenuCoord(null);
  }

  function openCellMenu(coord: string) {
    // Right-clicking a cell inside the current selection keeps the selection
    // so Copy/Cut operate on the whole range; right-clicking outside collapses
    // the selection onto the clicked cell (spreadsheet behavior).
    if (!isInRegion(coord, selection.anchor, selection.active)) {
      onCellActivate(coord);
    }
    setDropdownOpenCoord(null);
    setCellMenuCoord(coord);
  }

  function toggleDropdown(coord: string) {
    setDropdownOpenCoord((prev) => (prev === coord ? null : coord));
  }

  function selectDropdownValue(coord: string, optionValue: string) {
    setDropdownOpenCoord(null);
    onCellValueChange(coord, optionValue);
  }

  function handleDropdownKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = Array.from(
      document.querySelectorAll<HTMLDivElement>('[data-dropdown-option]')
    );
    const index = options.indexOf(event.currentTarget as HTMLDivElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        options[(index + 1) % options.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        options[(index - 1 + options.length) % options.length]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        setDropdownOpenCoord(null);
        break;
      default:
        break;
    }
  }

  function handleCellMenuPaste(coord: string) {
    closeCellMenu();
    onMenuPaste(coord);
  }

  function handleCellMenuKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-cell-menu-item]')
    );
    const index = items.indexOf(event.currentTarget);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        closeCellMenu();
        break;
      default:
        break;
    }
  }

  function handleCellMenuCopyCut(kind: 'copy' | 'cut') {
    closeCellMenu();
    onMenuCopyRange(kind);
  }

  function handleGridPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData?.getData('text');
    if (text == null) {
      return;
    }
    event.preventDefault();
    onPasteText(text, selection.anchor);
  }

  function handleGridCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    onCopyRange(event, 'copy');
  }

  function handleGridCut(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    onCopyRange(event, 'cut');
  }

  function openEdit(coord: string) {
    if (editCellRef.current?.coord === coord) {
      return; // keep the ongoing draft when the same cell is double-clicked again
    }
    const draft = cells[coord] ?? '';
    editCellRef.current = { coord, draft };
    setEditCell({ coord, draft });
  }

  function commitEdit() {
    const cell = editCellRef.current;
    if (!cell) {
      return;
    }
    editCellRef.current = null;
    setEditCell(null);
    onCellValueChange(cell.coord, cell.draft);
  }

  function cancelEdit() {
    editCellRef.current = null;
    setEditCell(null);
  }

  function handleEditDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }
  const columns = Array.from({ length: columnCount }, (_, i) => columnLetter(i));
  const rowsForGrid = Array.from({ length: rowCount }, (_, i) => i + 1);

  // Rows hidden by the active filter are not rendered (they are neither
  // deleted nor reordered; export and pivot logic still read them).
  const visibleRows = rowsForGrid.filter((row) => !rowIsFilteredOut(sheet, filter, row - 1));

  const handleRowHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: number) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ContextMenu') {
      event.preventDefault();
      onRowHeaderMenu(row);
    }
  };

  const handleColHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>, col: number) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ContextMenu') {
      event.preventDefault();
      onColHeaderMenu(col);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>, coord: string) => {
    const pos = cellToCoordinate(coord);
    if (!pos) {
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        onMoveSelection(-1, 0, event.shiftKey);
        break;
      case 'ArrowDown':
        event.preventDefault();
        onMoveSelection(1, 0, event.shiftKey);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        onMoveSelection(0, -1, event.shiftKey);
        break;
      case 'ArrowRight':
        event.preventDefault();
        onMoveSelection(0, 1, event.shiftKey);
        break;
      case 'Enter':
        event.preventDefault();
        onCommitMove(1, 0);
        break;
      case 'Escape':
        event.preventDefault();
        onRevertCell(coord);
        break;
      case 'ContextMenu':
        event.preventDefault();
        openCellMenu(coord);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="grid"
      aria-label="Worksheet grid"
      aria-multiselectable="true"
      className="worksheet-grid"
      onPaste={handleGridPaste}
      onCopy={handleGridCopy}
      onCut={handleGridCut}
    >
      <div role="row" aria-rowindex={1} className="grid-row header-row">
        <div role="columnheader" className="grid-header corner-header" />
        {columns.map((letter, i) => (
          <div
            key={letter}
            role="columnheader"
            aria-label={letter}
            aria-colindex={i + 1}
            tabIndex={0}
            data-col-header={i + 1}
            className="grid-header col-header"
            onContextMenu={(event) => {
              event.preventDefault();
              onColHeaderMenu(i + 1);
            }}
            onKeyDown={(event) => handleColHeaderKeyDown(event, i + 1)}
          >
            {letter}
            {colMenuCol === i + 1 && (
              <div
                role="menu"
                aria-label={`Column ${letter} options`}
                className="col-menu"
                data-col-menu={i + 1}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="col-menu-item"
                  data-col-menu-item
                  autoFocus
                  onClick={() => onColMenuAction('left', i + 1)}
                  onKeyDown={onColMenuKeyDown}
                >
                  Insert 1 column left
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="col-menu-item"
                  data-col-menu-item
                  onClick={() => onColMenuAction('right', i + 1)}
                  onKeyDown={onColMenuKeyDown}
                >
                  Insert 1 column right
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="col-menu-item"
                  data-col-menu-item
                  onClick={() => onColMenuAction('delete', i + 1)}
                  onKeyDown={onColMenuKeyDown}
                >
                  Delete column
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {visibleRows.map((row) => {
        const rowIndex = row - 1;
        return (
          <div key={row} role="row" aria-rowindex={row} className="grid-row">
            <div
              role="rowheader"
              aria-label={String(row)}
              tabIndex={0}
              data-row-header={row}
              className="grid-header row-header"
              onContextMenu={(event) => {
                event.preventDefault();
                onRowHeaderMenu(row);
              }}
              onKeyDown={(event) => handleRowHeaderKeyDown(event, row)}
            >
              {row}
              {rowMenuRow === row && (
                <div
                  role="menu"
                  aria-label={`Row ${row} options`}
                  className="row-menu"
                  data-row-menu={row}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="row-menu-item"
                    data-row-menu-item
                    autoFocus
                    onClick={() => onRowMenuAction('above', row)}
                    onKeyDown={onRowMenuKeyDown}
                  >
                    Insert 1 row above
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="row-menu-item"
                    data-row-menu-item
                    onClick={() => onRowMenuAction('below', row)}
                    onKeyDown={onRowMenuKeyDown}
                  >
                    Insert 1 row below
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="row-menu-item"
                    data-row-menu-item
                    onClick={() => onRowMenuAction('delete', row)}
                    onKeyDown={onRowMenuKeyDown}
                  >
                    Delete row
                  </button>
                </div>
              )}
            </div>
            {columns.map((_, i) => {
              const coord = coordinateToCell(rowIndex, i);
              const value = cells[coord] ?? '';
              const display = cellDisplayValue(value, cells, coord);
              const selected = isInRegion(coord, selection.anchor, selection.active);
              const editing = editCell && editCell.coord === coord;
              return (
                <GridCell
                  key={coord}
                  coord={coord}
                  value={value}
                  display={display}
                  selected={selected}
                  editDraft={editing ? editCell.draft : null}
                  filterButtonLabel={
                    isFilterHeaderCell(filter, rowIndex, i)
                      ? `Filter ${cells[coord] ?? ''}`
                      : null
                  }
                  dropdownValues={dropdownValuesForCoord(sheet, coord)}
                  dropdownOpen={dropdownOpenCoord === coord}
                  onToggleDropdown={() => toggleDropdown(coord)}
                  onSelectDropdownValue={(optionValue) =>
                    selectDropdownValue(coord, optionValue)
                  }
                  onDropdownKeyDown={handleDropdownKeyDown}
                  onOpenFilter={() => onOpenHeaderFilter(i)}
                  onActivate={() => onCellActivate(coord)}
                  onDrag={() => onCellDrag(coord)}
                  onChange={(value) => onCellValueChange(coord, value)}
                  onKeyDown={(event) => handleInputKeyDown(event, coord)}
                  onEditStart={(value) => onEditStart(coord, value)}
                  onDoubleClick={() => openEdit(coord)}
                  onEditDraftChange={(draft) =>
                    setEditCell({ coord, draft })
                  }
                  onEditDraftKeyDown={handleEditDraftKeyDown}
                  onEditDraftBlur={commitEdit}
                  menuOpen={cellMenuCoord === coord}
                  onOpenMenu={() => openCellMenu(coord)}
                  onMenuCopy={handleCellMenuCopyCut}
                  onMenuPaste={() => handleCellMenuPaste(coord)}
                  onMenuKeyDown={handleCellMenuKeyDown}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
