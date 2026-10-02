import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { filterHeaderColumns, parseRangeText } from "../domain/filter";
import { displayValues } from "../domain/formula";
import { dropdownValuesForCell } from "../domain/validation-rules";
import {
  cellName,
  clampCell,
  columnLabel,
  isWithinRegion,
  parseCellName,
  selectionRegion,
  type CellRef,
  type ColumnStructureAction,
  type RowStructureAction,
  type Selection,
  type ValidationRule,
  type Worksheet,
  type WorksheetFilter,
} from "../domain/workbook";
import { CellOptionsList } from "./CellOptionsList";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/Menu";

export interface WorksheetGridProps {
  worksheet: Worksheet;
  selection: Selection;
  /** Inline editor draft: the cell being edited and its uncommitted text. */
  editing: { name: string; text: string } | null;
  onSelect(selection: Selection): void;
  /** Persists the rectangle once the gesture ends (click, drag or keyboard move). */
  onSelectCommit?(selection: Selection): void;
  /** Starts the inline editor; `initialText` replaces the cell content when given. */
  onEditStart?(ref: CellRef, initialText?: string): void;
  onEditChange?(text: string): void;
  onEditCommit?(): void;
  onEditCancel?(): void;
  /** Clears the cell in one commit (Delete/Backspace on a selected cell). */
  onClearCell?(ref: CellRef): void;
  /** External clipboard text pasted into the active cell (REQ-3-1-2). */
  onPasteText?(text: string): void;
  /** Cell menu command that reads the system clipboard (REQ-3-1-2). */
  onPasteFromClipboard?(): void;
  /**
   * Copy/cut of the selected rectangle (REQ-3-2-1). The handler returns the
   * tab-separated text of the range, which the grid also offers to the system
   * clipboard so the browser's own Ctrl+C/Ctrl+X keeps working.
   */
  onCopyRange?(mode: "copy" | "cut"): string;
  /** Row-number menu command for the current worksheet (REQ-2-2-1). */
  onRowAction?(action: RowStructureAction, index: number): void;
  /** Column-header menu command for the current worksheet (REQ-2-2-2). */
  onColumnAction?(action: ColumnStructureAction, index: number): void;
  /** Persisted filter view; its header row carries the `Filter <header>` buttons. */
  filter?: WorksheetFilter;
  /** Data rows hidden by that filter: they are skipped, never reordered or cleared. */
  hiddenRows?: ReadonlySet<number>;
  /** Opens the value/condition dialog of one filtered column. */
  onFilterOpen?(header: string): void;
  /** Validation rules; a dropdown cell renders its `Open dropdown for <cell>` button. */
  validations?: readonly ValidationRule[];
  /** Writes one value chosen in the open list of a dropdown cell. */
  onDropdownSelect?(ref: CellRef, value: string): void;
}

interface HeaderMenuState {
  axis: "row" | "column";
  index: number;
  x: number;
  y: number;
}

interface CellMenuState {
  x: number;
  y: number;
}

/** Open option list of one dropdown cell (REQ-5-2-1). */
interface OptionsState {
  name: string;
  values: string[];
  current: string;
  x: number;
  y: number;
}

export function WorksheetGrid({
  worksheet,
  selection,
  editing,
  onSelect,
  onSelectCommit,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onClearCell,
  onPasteText,
  onPasteFromClipboard,
  onCopyRange,
  onRowAction,
  onColumnAction,
  filter,
  hiddenRows,
  onFilterOpen,
  validations,
  onDropdownSelect,
}: WorksheetGridProps) {
  const cellNodes = useRef(new Map<string, HTMLDivElement>());
  const gridRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLInputElement | null>(null);
  const draggingRef = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [menu, setMenu] = useState<HeaderMenuState | null>(null);
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [options, setOptions] = useState<OptionsState | null>(null);
  // Latest handlers for the document-level clipboard listeners (registered once
  // per render so an in-flight gesture never sees a stale closure).
  const clipboardHandlers = useRef({ onPasteText, onCopyRange });
  clipboardHandlers.current = { onPasteText, onCopyRange };
  const rowCount = worksheet.rowCount;
  const columnCount = worksheet.columnCount;
  const region = selectionRegion(selection);
  const focusName = cellName(selection.focus);
  // Formula cells show their calculated result; the stored text stays the input.
  const display = useMemo(() => displayValues(worksheet), [worksheet]);
  // Header row of the filter region carries the `Filter <header>` buttons; the
  // header text of a column is what the button (and its dialog) is named after.
  const filterHeaders = useMemo(
    () => (filter ? filterHeaderColumns(worksheet, filter) : []),
    [filter, worksheet],
  );
  const filterRegion = useMemo(() => (filter ? parseRangeText(filter.range) : null), [filter]);

  useEffect(() => {
    if (!editing) return;
    const node = editorRef.current;
    node?.focus();
    node?.select();
  }, [editing?.name]);

  useEffect(() => {
    // A drag can end outside the grid; the rectangle is persisted on release.
    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      onSelectCommit?.(selectionRef.current);
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [onSelectCommit]);

  /**
   * Clipboard events are handled on the document: the browser dispatches them at
   * the focused element, which is the grid cell for a click/drag selection but
   * the page body when nothing holds focus. A paste that starts inside a text
   * control (the formula bar, the paste box) stays with that control.
   */
  useEffect(() => {
    const inside = (node: EventTarget | null): boolean => {
      const element = node as HTMLElement | null;
      return Boolean(element && gridRef.current?.contains(element));
    };
    const isTextControl = (node: EventTarget | null): boolean => {
      const element = node as HTMLElement | null;
      return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA";
    };
    /** A text control whose own text is selected hands the copy to the browser. */
    const textSelection = (node: EventTarget | null): boolean => {
      const field = node as HTMLInputElement | null;
      return typeof field?.selectionStart === "number" && field.selectionStart !== field.selectionEnd;
    };
    const gridHasFocus = () => inside(document.activeElement);

    const startTransfer = (event: ClipboardEvent, mode: "copy" | "cut") => {
      if (isTextControl(event.target)) {
        // Typing in the formula bar with selected text keeps the browser copy.
        if (textSelection(event.target)) return;
      } else if (!inside(event.target) && !gridHasFocus()) {
        return;
      }
      // The editor declines with "" while a cell draft is open.
      const text = clipboardHandlers.current.onCopyRange?.(mode);
      if (!text) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };
    const onCopy = (event: ClipboardEvent) => startTransfer(event, "copy");
    const onCut = (event: ClipboardEvent) => startTransfer(event, "cut");
    const onPaste = (event: ClipboardEvent) => {
      if (isTextControl(event.target)) return;
      // An empty system clipboard still reaches the app: it falls back to the
      // range the app itself copied (REQ-3-2-1).
      const text = event.clipboardData?.getData("text/plain") ?? "";
      event.preventDefault();
      clipboardHandlers.current.onPasteText?.(text);
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  const moveFocus = (row: number, col: number, extend: boolean) => {
    const next = clampCell({ row, col }, rowCount, columnCount);
    const selection2 = extend ? { anchor: selection.anchor, focus: next } : { anchor: next, focus: next };
    onSelect(selection2);
    onSelectCommit?.(selection2);
    cellNodes.current.get(cellName(next))?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, ref: CellRef) => {
    const extend = event.shiftKey;
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveFocus(ref.row - 1, ref.col, extend);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(ref.row + 1, ref.col, extend);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(ref.row, ref.col - 1, extend);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveFocus(ref.row, ref.col + 1, extend);
        return;
      case "Home":
        event.preventDefault();
        moveFocus(ref.row, 0, extend);
        return;
      case "End":
        event.preventDefault();
        moveFocus(ref.row, columnCount - 1, extend);
        return;
      case "Enter":
      case "F2":
        event.preventDefault();
        onEditStart?.(ref);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        onClearCell?.(ref);
        return;
      default:
        // Typing a printable character on a selected cell starts an inline edit
        // that replaces the cell content.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          onEditStart?.(ref, event.key);
        }
    }
  };

  const selectCell = (ref: CellRef, extend: boolean) => {
    const next = extend ? { anchor: selection.anchor, focus: ref } : { anchor: ref, focus: ref };
    onSelect(next);
    cellNodes.current.get(cellName(ref))?.focus();
  };

  const openMenu = (axis: "row" | "column", index: number, x: number, y: number, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setMenu({ axis, index, x, y });
  };

  /** Closing returns focus to the row/column header that opened the menu. */
  const closeMenu = () => {
    setMenu(null);
    triggerRef.current?.focus();
  };

  /** Right-click opens the header menu at the pointer; Shift+F10 opens it at the header. */
  const headerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, axis: "row" | "column", index: number) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(axis, index, rect.left + 8, rect.bottom, event.currentTarget);
  };

  /**
   * Right-click opens the cell menu and keeps the current rectangle when the
   * click lands inside it (so Copy/Cut/Paste act on the selected range); a click
   * outside the rectangle selects that cell first. Shift+F10 opens the same menu
   * from the keyboard.
   */
  const openCellMenu = (ref: CellRef, x: number, y: number, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    if (!isWithinRegion(ref, selectionRegion(selectionRef.current))) {
      selectCell(ref, false);
      onSelectCommit?.({ anchor: ref, focus: ref });
    }
    setCellMenu({ x, y });
  };

  const cellKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, ref: CellRef) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openCellMenu(ref, rect.left + 8, rect.bottom, event.currentTarget);
  };

  const closeCellMenu = () => {
    setCellMenu(null);
    triggerRef.current?.focus();
  };

  const menuItems = (state: HeaderMenuState): MenuItem[] => (
    state.axis === "row"
      ? [
        { id: "insert-above", label: "Insert 1 row above", onSelect: () => onRowAction?.("insert-above", state.index) },
        { id: "insert-below", label: "Insert 1 row below", onSelect: () => onRowAction?.("insert-below", state.index) },
        { id: "delete", label: "Delete row", tone: "danger", onSelect: () => onRowAction?.("delete", state.index) },
      ]
      : [
        { id: "insert-left", label: "Insert 1 column left", onSelect: () => onColumnAction?.("insert-left", state.index) },
        { id: "insert-right", label: "Insert 1 column right", onSelect: () => onColumnAction?.("insert-right", state.index) },
        { id: "delete", label: "Delete column", tone: "danger", onSelect: () => onColumnAction?.("delete", state.index) },
      ]
  );

  const cellMenuItems = (): MenuItem[] => [
    { id: "copy", label: "Copy", onSelect: () => onCopyRange?.("copy") },
    { id: "cut", label: "Cut", onSelect: () => onCopyRange?.("cut") },
    { id: "paste", label: "Paste", onSelect: () => onPasteFromClipboard?.() },
  ];

  return (
    <>
      <div
        ref={gridRef}
        className="worksheet-grid"
        role="grid"
        aria-label="Worksheet grid"
        aria-multiselectable="true"
      >
        <div
          className="worksheet-grid__row worksheet-grid__row--columns"
          role="row"
          style={{ gridTemplateColumns: `3rem repeat(${columnCount}, minmax(6rem, 1fr))` }}
        >
          <div className="worksheet-grid__corner" aria-hidden="true" />
          {Array.from({ length: columnCount }, (_, col) => (
            <div
              key={col}
              role="columnheader"
              aria-label={columnLabel(col)}
              tabIndex={0}
              className="worksheet-grid__column-header"
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu("column", col, event.clientX, event.clientY, event.currentTarget);
              }}
              onKeyDown={(event) => headerKeyDown(event, "column", col)}
            >
              {columnLabel(col)}
            </div>
          ))}
        </div>
        {Array.from({ length: rowCount }, (_, row) => {
          // A filtered-out row is hidden only: it is skipped while rendering,
          // never rewritten, reordered or copied elsewhere.
          if (hiddenRows?.has(row)) return null;
          return (
            <div
              key={row}
              className="worksheet-grid__row"
              role="row"
              style={{ gridTemplateColumns: `3rem repeat(${columnCount}, minmax(6rem, 1fr))` }}
            >
            <div
              role="rowheader"
              aria-label={String(row + 1)}
              tabIndex={0}
              className="worksheet-grid__row-header"
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu("row", row, event.clientX, event.clientY, event.currentTarget);
              }}
              onKeyDown={(event) => headerKeyDown(event, "row", row)}
            >
              {row + 1}
            </div>
            {Array.from({ length: columnCount }, (_, col) => {
              const ref = { row, col };
              const name = cellName(ref);
              const selected = isWithinRegion(ref, region);
              const isEditing = editing?.name === name;
              const headerEntry = filterRegion && row === filterRegion.minRow
                ? filterHeaders.find((entry) => entry.col === col)
                : undefined;
              const dropdownValues = dropdownValuesForCell(validations, ref);
              return (
                <div
                  key={col}
                  ref={(node) => {
                    if (node) cellNodes.current.set(name, node);
                    else cellNodes.current.delete(name);
                  }}
                  role="gridcell"
                  aria-label={name}
                  aria-selected={selected}
                  data-cell={name}
                  data-selected={selected ? "true" : undefined}
                  data-filter-header={headerEntry?.header}
                  tabIndex={name === focusName ? 0 : -1}
                  className="worksheet-grid__cell"
                  onPointerDown={(event) => {
                    // Unknown `button` (jsdom pointer shims) is treated as primary.
                    if ((event.button && event.button !== 0) || isEditing) return;
                    if (event.shiftKey) {
                      selectCell(ref, true);
                      return;
                    }
                    draggingRef.current = true;
                    selectCell(ref, false);
                  }}
                  onPointerEnter={(event) => {
                    if (!draggingRef.current) return;
                    if (typeof event.buttons === "number" && event.buttons !== 1) return;
                    onSelect({ anchor: selection.anchor, focus: ref });
                  }}
                  onDoubleClick={() => onEditStart?.(ref)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openCellMenu(ref, event.clientX, event.clientY, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    // Keys typed inside the inline editor belong to the text box.
                    if ((event.target as HTMLElement).tagName === "INPUT") return;
                    cellKeyDown(event, ref);
                    if (!event.defaultPrevented) handleKeyDown(event, ref);
                  }}
                >
                  {isEditing ? (
                    <input
                      ref={editorRef}
                      className="worksheet-grid__editor"
                      type="text"
                      aria-label={`Edit ${name}`}
                      value={editing?.text ?? ""}
                      onChange={(event) => onEditChange?.(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onEditCommit?.();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          onEditCancel?.();
                        } else if (event.key === "Tab") {
                          event.preventDefault();
                          onEditCommit?.();
                        }
                      }}
                      onBlur={() => onEditCommit?.()}
                    />
                  ) : (
                    display[name] ?? ""
                  )}
                  {headerEntry ? (
                    <button
                      type="button"
                      className="worksheet-grid__filter"
                      aria-label={`Filter ${headerEntry.header}`}
                      data-filter-active={filter?.rules.some((rule) => rule.header === headerEntry.header) ? "true" : undefined}
                      onPointerDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={() => onFilterOpen?.(headerEntry.header)}
                    />
                  ) : null}
                  {dropdownValues ? (
                    <button
                      type="button"
                      className="worksheet-grid__dropdown"
                      aria-label={`Open dropdown for ${name}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setOptions({
                          name,
                          values: dropdownValues,
                          current: worksheet.cells[name] ?? "",
                          x: rect.left,
                          y: rect.bottom,
                        });
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          );
        })}
      </div>
      {options ? (
        <CellOptionsList
          key={options.name}
          label={`Options for ${options.name}`}
          values={options.values}
          current={options.current}
          position={{ x: options.x, y: options.y }}
          onSelect={(value) => {
            const ref = parseCellName(options.name);
            setOptions(null);
            if (ref) onDropdownSelect?.(ref, value);
          }}
          onClose={() => setOptions(null)}
        />
      ) : null}
      {menu ? (
        <ContextMenu
          key={`${menu.axis}-${menu.index}`}
          label={menu.axis === "row" ? `Row ${menu.index + 1} menu` : `Column ${columnLabel(menu.index)} menu`}
          position={{ x: menu.x, y: menu.y }}
          items={menuItems(menu)}
          onClose={closeMenu}
        />
      ) : null}
      {cellMenu ? (
        <ContextMenu
          key="cell-menu"
          label={`Cell ${focusName} menu`}
          position={{ x: cellMenu.x, y: cellMenu.y }}
          items={cellMenuItems()}
          onClose={closeCellMenu}
        />
      ) : null}
    </>
  );
}
