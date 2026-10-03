import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Selection, StructureCommand } from "../domain/types";
import { seededWorkbook } from "../test/fixtures";
import { WorksheetGrid } from "./WorksheetGrid";

const sheet1 = seededWorkbook.worksheets[0];

function renderGrid(props: Partial<Parameters<typeof WorksheetGrid>[0]> = {}) {
  const onStructureCommand = vi.fn<(command: StructureCommand) => void>();
  const utils = render(<WorksheetGrid worksheet={sheet1} onStructureCommand={onStructureCommand} {...props} />);
  return { onStructureCommand, ...utils };
}

describe("worksheet grid structure", () => {
  afterEach(cleanup);

  it("exposes row numbers as rowheaders and column letters as columnheaders", () => {
    renderGrid();

    expect(screen.getByRole("rowheader", { name: "1" })).toHaveTextContent("1");
    expect(screen.getByRole("rowheader", { name: "2" })).toHaveTextContent("2");
    expect(screen.getByRole("rowheader", { name: "30" })).toHaveTextContent("30");
    expect(screen.getAllByRole("rowheader")).toHaveLength(30);

    const columnHeaders = screen.getAllByRole("columnheader").map((node) => node.textContent);
    expect(columnHeaders.slice(0, 3)).toEqual(["A", "B", "C"]);
    expect(columnHeaders.at(-1)).toBe("Z");
    expect(screen.getByRole("columnheader", { name: "A" })).toHaveAttribute("aria-colindex", "2");

    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");
  });

  it("opens the row-number menu on right click and reports the chosen command", async () => {
    const { onStructureCommand } = renderGrid();
    const user = userEvent.setup();

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }), { clientX: 12, clientY: 34 });

    const menu = screen.getByRole("menu");
    expect(menu).toHaveAccessibleName("Row 2 menu");
    expect(screen.getAllByRole("menuitem").map((node) => node.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);

    await user.click(screen.getByRole("menuitem", { name: "Insert 1 row below" }));

    expect(onStructureCommand).toHaveBeenCalledWith({ axis: "row", action: "insert-below", index: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the column-header menu and reports insert-left", async () => {
    const { onStructureCommand } = renderGrid();
    const user = userEvent.setup();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));

    expect(screen.getAllByRole("menuitem").map((node) => node.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);

    await user.click(screen.getByRole("menuitem", { name: "Insert 1 column right" }));
    expect(onStructureCommand).toHaveBeenCalledWith({ axis: "column", action: "insert-right", index: 1 });

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "A" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete column" }));
    expect(onStructureCommand).toHaveBeenLastCalledWith({ axis: "column", action: "delete", index: 0 });
  });

  it("opens the row menu from the keyboard and closes it with Escape", async () => {
    const { onStructureCommand } = renderGrid();
    const user = userEvent.setup();

    const header = screen.getByRole("rowheader", { name: "3" });
    header.focus();
    await user.keyboard("{ContextMenu}");
    expect(screen.getByRole("menu")).toHaveAccessibleName("Row 3 menu");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onStructureCommand).not.toHaveBeenCalled();
    expect(header).toHaveFocus();
  });

  it("does not open a menu while a structure change is in flight", async () => {
    renderGrid({ structureDisabled: true });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("hides the menu when the worksheet changes", () => {
    const onStructureCommand = vi.fn<(command: StructureCommand) => void>();
    const { rerender } = render(
      <WorksheetGrid worksheet={sheet1} onStructureCommand={onStructureCommand} />,
    );

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    rerender(
      <WorksheetGrid worksheet={seededWorkbook.worksheets[1]} onStructureCommand={onStructureCommand} />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("worksheet grid selection and editing", () => {
  afterEach(cleanup);

  it("selects a single cell on click and reports the selection", async () => {
    const onSelect = vi.fn<(selection: Selection) => void>();
    renderGrid({ onSelect });
    const user = userEvent.setup();

    await user.click(screen.getByRole("gridcell", { name: "D1" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual({ anchor: "D1", focus: "D1" });
  });

  it("drags from one corner to the opposite cell and shows the whole rectangle", () => {
    const onSelect = vi.fn<(selection: Selection) => void>();
    renderGrid({ onSelect });

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "E2" }));

    for (const name of ["D1", "E1", "D2", "E2"]) {
      expect(screen.getByRole("gridcell", { name })).toHaveAttribute("aria-selected", "true");
    }
    for (const name of ["C1", "D3", "E3", "F1"]) {
      expect(screen.getByRole("gridcell", { name })).toHaveAttribute("aria-selected", "false");
    }

    fireEvent.mouseUp(window);
    expect(onSelect).toHaveBeenCalledWith({ anchor: "D1", focus: "E2" });
  });

  it("moves the active cell with the arrow keys", async () => {
    const onSelect = vi.fn<(selection: Selection) => void>();
    const { rerender } = renderGrid({ onSelect });

    const a1 = screen.getByRole("gridcell", { name: "A1" });
    a1.focus();
    fireEvent.keyDown(a1, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith({ anchor: "A2", focus: "A2" });

    rerender(
      <WorksheetGrid
        worksheet={{ ...sheet1, selection: { anchor: "A2", focus: "A2" } }}
        onSelect={onSelect}
      />,
    );
    const a2 = screen.getByRole("gridcell", { name: "A2" });
    expect(a2).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(a2, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith({ anchor: "B2", focus: "B2" });
  });

  it("opens an inline text box named after the cell on double click", async () => {
    const onStartEdit = vi.fn<(cell: string, input: string) => void>();
    const { rerender } = renderGrid({ onStartEdit });
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole("gridcell", { name: "B2" }));
    expect(onStartEdit).toHaveBeenCalledWith("B2", "1200");

    rerender(
      <WorksheetGrid worksheet={sheet1} editing={{ cell: "B2", input: "1200" }} onStartEdit={onStartEdit} />,
    );
    expect(screen.getByRole("textbox", { name: "Edit B2" })).toHaveValue("1200");
  });

  it("starts the inline editor when a printable character is typed", () => {
    const onStartEdit = vi.fn<(cell: string, input: string) => void>();
    renderGrid({ onStartEdit });

    const a1 = screen.getByRole("gridcell", { name: "A1" });
    a1.focus();
    fireEvent.keyDown(a1, { key: "E" });

    expect(onStartEdit).toHaveBeenCalledWith("A1", "E");
  });

  it("commits the inline editor with Enter and cancels it with Escape", async () => {
    const onCommitEdit = vi.fn();
    const onCancelEdit = vi.fn();
    const onInputChange = vi.fn();
    const user = userEvent.setup();

    const { unmount } = render(
      <WorksheetGrid
        worksheet={sheet1}
        editing={{ cell: "D1", input: "East" }}
        onInputChange={onInputChange}
        onCommitEdit={onCommitEdit}
        onCancelEdit={onCancelEdit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Edit D1" });
    await user.type(input, "x");
    expect(onInputChange).toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onCommitEdit).toHaveBeenCalled();
    unmount();

    render(
      <WorksheetGrid
        worksheet={sheet1}
        editing={{ cell: "D1", input: "East" }}
        onCommitEdit={onCommitEdit}
        onCancelEdit={onCancelEdit}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancelEdit).toHaveBeenCalled();
    expect(onCommitEdit).toHaveBeenCalledTimes(1);
  });

  it("offers Paste in the cell context menu with the cell as the starting cell", async () => {
    const onPasteRequest = vi.fn<(cell: string) => void>();
    const onSelect = vi.fn<(selection: Selection) => void>();
    renderGrid({ onPasteRequest, onSelect });
    const user = userEvent.setup();

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "B2" }), { clientX: 10, clientY: 20 });

    const menu = screen.getByRole("menu");
    expect(menu).toHaveAccessibleName("Cell B2 menu");
    const paste = screen.getByRole("menuitem", { name: "Paste" });
    expect(onSelect).toHaveBeenCalledWith({ anchor: "B2", focus: "B2" });

    await user.click(paste);
    expect(onPasteRequest).toHaveBeenCalledWith("B2");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("reports pasted clipboard text starting at the selected cell", () => {
    const onPaste = vi.fn<(cell: string, text: string) => void>();
    const worksheet = { ...sheet1, selection: { anchor: "D1", focus: "D1" } };
    render(<WorksheetGrid worksheet={worksheet} onPaste={onPaste} />);

    fireEvent.paste(screen.getByRole("gridcell", { name: "D1" }), {
      clipboardData: { getData: () => "East\t1200\nNorth\t800" },
    });

    expect(onPaste).toHaveBeenCalledWith("D1", "East\t1200\nNorth\t800");
  });

  it("offers Copy and Cut in the cell context menu and reports them", async () => {
    const onCopy = vi.fn();
    const onCut = vi.fn();
    renderGrid({ onCopy, onCut });
    const user = userEvent.setup();

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "B2" }));
    expect(screen.getAllByRole("menuitem").map((node) => node.textContent)).toEqual(["Copy", "Cut", "Paste"]);

    await user.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "B2" }));
    await user.click(screen.getByRole("menuitem", { name: "Cut" }));
    expect(onCut).toHaveBeenCalledTimes(1);
  });

  it("reports Ctrl+C and Ctrl+X without hijacking plain typing", () => {
    const onCopy = vi.fn();
    const onCut = vi.fn();
    const onStartEdit = vi.fn<(cell: string, input: string) => void>();
    renderGrid({ onCopy, onCut, onStartEdit });

    const a1 = screen.getByRole("gridcell", { name: "A1" });
    a1.focus();
    fireEvent.keyDown(a1, { key: "c", ctrlKey: true });
    expect(onCopy).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(a1, { key: "x", ctrlKey: true });
    expect(onCut).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(a1, { key: "E" });
    expect(onStartEdit).toHaveBeenCalledWith("A1", "E");
  });
});
