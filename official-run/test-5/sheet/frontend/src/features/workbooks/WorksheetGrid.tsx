import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { CellDropdown } from "./CellDropdown";
import { cellAddress, columnLabels, parseCellAddress } from "./coordinates";
import {
  dropdownRuleFor,
  filterButtonLabel,
  headerTextFor,
  regionColumns,
  regionHeaderRow,
} from "./filtering";
import {
  cellEditorLabel,
  cellMenuLabel,
  isFormControl,
  PASTE_COMMAND,
  PASTE_COMMAND_LABEL,
} from "./gridEditing";
import { GridContextMenu, type GridMenuItem } from "./GridContextMenu";
import { COPY_COMMAND, COPY_COMMAND_LABEL, CUT_COMMAND, CUT_COMMAND_LABEL, type CellRange } from "./rangeTransfer";
import { isCellSelected, selectionBounds, type CellSelection } from "./selection";
import {
  COLUMN_COMMANDS,
  ROW_COMMANDS,
  columnMenuLabel,
  rowMenuLabel,
  type StructureAxis,
  type StructureOperation,
} from "./structure";
import type { ValidationRule, WorksheetFilter } from "./types";

export const DEFAULT_COLUMN_COUNT = 20;
export const DEFAULT_ROW_COUNT = 40;

export interface WorksheetGridProps {
  /** Raw cell texts; the formula bar and the inline editor work on these. */
  cells: Readonly<Record<string, string>>;
  /** Displayed values (formula results); falls back to `cells` when absent. */
  values?: Readonly<Record<string, string>>;
  selection: CellSelection;
  /** True while a cell write is in flight; the grid stops accepting edits. */
  busy?: boolean;
  /** True while a row/column operation is in flight; header menus stop opening. */
  structureBusy?: boolean;
  /** Rectangle copied or cut and waiting to be pasted, highlighted in the grid. */
  copiedRange?: CellRange | null;
  /** Data region the worksheet filters on; its header row carries the buttons. */
  filter?: WorksheetFilter | null;
  /** Data rows of the filter range that do not match, i.e. are hidden. */
  hiddenRows?: readonly number[];
  /** Validation rules of the worksheet, used for the dropdown entry points. */
  validations?: readonly ValidationRule[];
  /** `persist` is true when the rectangle should be stored with the worksheet. */
  onSelectionChange(selection: CellSelection, persist: boolean): void;
  onCommitEdit(address: string, text: string): void;
  /** Pasted clipboard text (Ctrl+V or a paste event). */
  onPasteText(text: string): void;
  /** The "Paste" menu command: pastes the remembered range or the clipboard. */
  onPasteRequest(): void;
  /** The "Copy" menu command: remembers the selected rectangle. */
  onCopyRequest?(): void;
  /** The "Cut" menu command: remembers the selected rectangle as a move. */
  onCutRequest?(): void;
  onStructureCommand?(axis: StructureAxis, operation: StructureOperation, index: number): void;
  /** "Filter <header text>" button of one filtered header column. */
  onFilterClick?(column: string, headerText: string): void;
  /** Option chosen in the dropdown list of a dropdown-validated cell. */
  onDropdownSelect?(address: string, value: string): void;
}

interface OpenMenu {
  /** What the menu was opened from. */
  kind: StructureAxis | "cell";
  /** 1-based row number, 1-based column index, or the cell coordinate. */
  index: number | string;
  label: string;
  x: number;
  y: number;
}

interface EditorState {
  address: string;
  draft: string;
}

const CELL_MENU_ITEMS: readonly GridMenuItem[] = [
  { id: CUT_COMMAND, label: CUT_COMMAND_LABEL },
  { id: COPY_COMMAND, label: COPY_COMMAND_LABEL },
  { id: PASTE_COMMAND, label: PASTE_COMMAND_LABEL },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function WorksheetGrid({
  cells,
  values,
  selection,
  busy = false,
  structureBusy = false,
  copiedRange = null,
  filter = null,
  hiddenRows,
  validations,
  onSelectionChange,
  onCommitEdit,
  onPasteText,
  onPasteRequest,
  onCopyRequest,
  onCutRequest,
  onStructureCommand,
  onFilterClick,
  onDropdownSelect,
}: WorksheetGridProps) {
  const columns = useMemo(() => columnLabels(DEFAULT_COLUMN_COUNT), []);
  const rows = useMemo(
    () => Array.from({ length: DEFAULT_ROW_COUNT }, (_, index) => index + 1),
    [],
  );
  const bounds = useMemo(() => selectionBounds(selection), [selection]);
  const copiedBounds = useMemo(
    () => (copiedRange ? selectionBounds({ anchor: copiedRange.start, focus: copiedRange.end }) : null),
    [copiedRange],
  );
  const hidden = useMemo(() => new Set(hiddenRows ?? []), [hiddenRows]);
  const filterHeaderRow = useMemo(() => (filter ? regionHeaderRow(filter.range) : 0), [filter]);
  const filterColumns = useMemo(() => (filter ? regionColumns(filter.range) : []), [filter]);
  const rules = useMemo(() => (Array.isArray(validations) ? validations : []), [validations]);
  const gridRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [editing, setEditing] = useState<EditorState | null>(null);
  /** Coordinate of the dropdown cell whose option list is open. */
  const [dropdownCell, setDropdownCell] = useState<string | null>(null);
  /** Mirror of `editing` so handlers always see the live draft. */
  const editingRef = useRef<EditorState | null>(null);
  const selectAllRef = useRef(false);
  const draggingRef = useRef(false);
  const dragSelectionRef = useRef<CellSelection | null>(null);

  const openEditor = useCallback((address: string, initial: string, selectAll: boolean) => {
    if (busy) return;
    setDropdownCell(null);
    selectAllRef.current = selectAll;
    const next = { address, draft: initial };
    editingRef.current = next;
    setEditing(next);
  }, [busy]);

  const closeEditor = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
  }, []);

  /** Commits the inline draft; the grid shows the stored value until the answer arrives. */
  const commitEditor = useCallback((refocus = false) => {
    const current = editingRef.current;
    if (!current) return;
    closeEditor();
    if (refocus) {
      queueMicrotask(() => {
        gridRef.current?.querySelector<HTMLElement>(`[data-cell="${current.address}"]`)?.focus();
      });
    }
    onCommitEdit(current.address, current.draft);
  }, [closeEditor, onCommitEdit]);

  /** Closes the inline text box, keeping the selection reachable from the keyboard. */
  const cancelEditor = useCallback(() => {
    const current = editingRef.current;
    closeEditor();
    if (!current) return;
    queueMicrotask(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${current.address}"]`)?.focus();
    });
  }, [closeEditor]);

  /** Focuses the freshly mounted inline text box and places the caret. */
  const attachEditor = useCallback((node: HTMLInputElement | null) => {
    if (!node) return;
    node.focus();
    const end = node.value.length;
    if (selectAllRef.current) node.setSelectionRange(0, end);
    else node.setSelectionRange(end, end);
    selectAllRef.current = false;
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(null);
    openerRef.current?.focus();
  }, []);

  const openMenu = (
    head: { kind: OpenMenu["kind"]; index: number | string; label: string },
    x: number,
    y: number,
    opener: HTMLElement,
  ) => {
    if (structureBusy) return;
    openerRef.current = opener;
    setMenu({ ...head, x, y });
  };

  /** Turns a header key press into the same menu a right click opens. */
  const handleHeaderKeyDown = (
    head: { kind: OpenMenu["kind"]; index: number | string; label: string },
  ) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(head, rect.left, rect.bottom, event.currentTarget);
  };

  const move = (rowDelta: number, columnDelta: number) => {
    const current = parseCellAddress(selection.anchor);
    if (!current) return;
    const address = cellAddress(
      clamp(current.column + columnDelta, 1, DEFAULT_COLUMN_COUNT),
      clamp(current.row + rowDelta, 1, DEFAULT_ROW_COUNT),
    );
    onSelectionChange({ anchor: address, focus: address }, true);
    queueMicrotask(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-cell="${address}"]`)
        ?.focus();
    });
  };

  /** Starts a selection rectangle at the pressed cell. */
  const beginDrag = (address: string) => {
    setDropdownCell(null);
    const next = { anchor: address, focus: address };
    draggingRef.current = true;
    dragSelectionRef.current = next;
    onSelectionChange(next, false);
  };

  /** Extends the rectangle to the cell the pointer entered. */
  const extendDrag = (address: string) => {
    if (!draggingRef.current) return;
    const next = { anchor: dragSelectionRef.current?.anchor ?? address, focus: address };
    dragSelectionRef.current = next;
    onSelectionChange(next, false);
  };

  useEffect(() => {
    const finish = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const final = dragSelectionRef.current;
      dragSelectionRef.current = null;
      if (final) onSelectionChange(final, true);
    };
    document.addEventListener("mouseup", finish);
    return () => document.removeEventListener("mouseup", finish);
  }, [onSelectionChange]);

  /**
   * A browser may deliver Ctrl+V to the document instead of the focused cell;
   * the event is handled here when the grid holds focus, so a paste is never
   * lost. Events raised inside the grid keep their React handler.
   */
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as Node | null;
      if (target && gridRef.current?.contains(target)) return;
      const active = document.activeElement;
      if (!active || !gridRef.current?.contains(active)) return;
      event.preventDefault();
      onPasteText(event.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onPasteText]);

  const handleCellKeyDown = (event: KeyboardEvent<HTMLElement>, address: string) => {
    if (isFormControl(event.target)) return;
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      openEditor(address, cells[address] ?? "", true);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openEditor(address, event.key, false);
    }
  };

  return (
    <div
      ref={gridRef}
      className="worksheet-grid"
      role="grid"
      aria-label="Worksheet grid"
      aria-multiselectable="true"
      aria-busy={busy || structureBusy}
      onKeyDown={(event) => {
        if (isFormControl(event.target)) return;
        const moves: Record<string, [number, number]> = {
          ArrowUp: [-1, 0],
          ArrowDown: [1, 0],
          ArrowLeft: [0, -1],
          ArrowRight: [0, 1],
        };
        const delta = moves[event.key];
        if (!delta) return;
        event.preventDefault();
        move(delta[0], delta[1]);
      }}
      onPaste={(event) => {
        if (isFormControl(event.target)) return;
        event.preventDefault();
        onPasteText(event.clipboardData?.getData("text/plain") ?? "");
      }}
    >
      <div role="row" className="worksheet-grid__row worksheet-grid__row--header">
        <div role="columnheader" aria-hidden="true" className="worksheet-grid__corner" />
        {columns.map((label, index) => {
          const head = { kind: "column" as const, index: index + 1, label: columnMenuLabel(label) };
          return (
            <div
              key={label}
              role="columnheader"
              aria-label={label}
              className="worksheet-grid__head"
              data-column={label}
              tabIndex={-1}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(head, event.clientX, event.clientY, event.currentTarget);
              }}
              onKeyDown={handleHeaderKeyDown(head)}
            >
              {label}
            </div>
          );
        })}
      </div>
      {rows.map((rowNumber) => {
        const head = { kind: "row" as const, index: rowNumber, label: rowMenuLabel(rowNumber) };
        const rowHidden = hidden.has(rowNumber);
        return (
          <div
            key={rowNumber}
            role="row"
            className="worksheet-grid__row"
            data-row-hidden={rowHidden ? "true" : undefined}
            style={rowHidden ? { display: "none" } : undefined}
          >
            <div
              role="rowheader"
              aria-label={String(rowNumber)}
              className="worksheet-grid__head worksheet-grid__head--row"
              data-row={rowNumber}
              tabIndex={-1}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(head, event.clientX, event.clientY, event.currentTarget);
              }}
              onKeyDown={handleHeaderKeyDown(head)}
            >
              {rowNumber}
            </div>
            {columns.map((label) => {
              const address = `${label}${rowNumber}`;
              const selected = isCellSelected(bounds, address);
              const copied = copiedBounds ? isCellSelected(copiedBounds, address) : false;
              const value = values?.[address] ?? cells[address] ?? "";
              const isEditing = editing?.address === address;
              const showsFilter = Boolean(
                filter && rowNumber === filterHeaderRow && filterColumns.includes(label),
              );
              const dropdownRule = rules.length > 0 ? dropdownRuleFor({ validations: rules }, address) : null;
              return (
                <div
                  key={address}
                  role="gridcell"
                  aria-label={address}
                  aria-selected={selected}
                  data-cell={address}
                  tabIndex={selected ? 0 : -1}
                  className={[
                    "worksheet-grid__cell",
                    selected ? "worksheet-grid__cell--selected" : "",
                    copied ? "worksheet-grid__cell--copied" : "",
                    showsFilter || dropdownRule ? "worksheet-grid__cell--with-trigger" : "",
                  ].filter(Boolean).join(" ")}
                  onMouseDown={(event) => {
                    if (isFormControl(event.target)) return;
                    event.currentTarget.focus();
                    beginDrag(address);
                  }}
                  onMouseEnter={() => extendDrag(address)}
                  onDoubleClick={(event) => {
                    if (isFormControl(event.target)) return;
                    openEditor(address, cells[address] ?? "", true);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(
                      { kind: "cell", index: address, label: cellMenuLabel(address) },
                      event.clientX,
                      event.clientY,
                      event.currentTarget,
                    );
                  }}
                  onKeyDown={(event) => handleCellKeyDown(event, address)}
                >
                  {isEditing ? (
                    <input
                      ref={attachEditor}
                      className="worksheet-grid__editor"
                      type="text"
                      aria-label={cellEditorLabel(address)}
                      value={editing.draft}
                      onChange={(event) => {
                        const next = { address, draft: event.target.value };
                        editingRef.current = next;
                        setEditing(next);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitEditor(true);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEditor();
                        }
                      }}
                      onBlur={() => commitEditor()}
                    />
                  ) : value}
                  {!isEditing && showsFilter ? (
                    <button
                      type="button"
                      className="worksheet-grid__filter"
                      aria-label={filterButtonLabel(headerTextFor({ cells, values }, filter!.range, label))}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        event.stopPropagation();
                        onFilterClick?.(label, headerTextFor({ cells, values }, filter!.range, label));
                      }}
                    />
                  ) : null}
                  {!isEditing && dropdownRule ? (
                    <button
                      type="button"
                      className="worksheet-grid__dropdown-trigger"
                      aria-label={`Open dropdown for ${address}`}
                      aria-haspopup="listbox"
                      aria-expanded={dropdownCell === address}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDropdownCell((current) => (current === address ? null : address));
                      }}
                    />
                  ) : null}
                  {!isEditing && dropdownRule && dropdownCell === address ? (
                    <CellDropdown
                      address={address}
                      values={dropdownRule.values ?? []}
                      current={value}
                      disabled={busy}
                      onSelect={(chosen) => {
                        setDropdownCell(null);
                        onDropdownSelect?.(address, chosen);
                      }}
                      onClose={() => setDropdownCell(null)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {menu ? (
        <GridContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.label}
          items={menu.kind === "cell"
            ? CELL_MENU_ITEMS
            : (menu.kind === "row" ? ROW_COMMANDS : COLUMN_COMMANDS).map((command) => ({
              id: command.operation,
              label: command.label,
            }))}
          onSelect={(id) => {
            const target = menu;
            setMenu(null);
            openerRef.current?.focus();
            if (target.kind === "cell") {
              if (id === PASTE_COMMAND) onPasteRequest();
              else if (id === COPY_COMMAND) onCopyRequest?.();
              else if (id === CUT_COMMAND) onCutRequest?.();
              return;
            }
            onStructureCommand?.(target.kind, id as StructureOperation, target.index as number);
          }}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
