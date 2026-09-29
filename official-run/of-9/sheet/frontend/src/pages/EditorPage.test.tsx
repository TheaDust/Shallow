import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditorPage } from "./EditorPage";
import { clearHistory } from "../domain/history";
import { clearClipboardBuffer, setLastExternalText } from "../domain/clipboard";
import { seededWorkbook } from "../test/fixtures";

const api = vi.hoisted(() => ({
  listWorkbooks: vi.fn(),
  createWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  renameWorkbook: vi.fn(),
  setActiveSheet: vi.fn(),
  importWorkbook: vi.fn(),
  addWorksheet: vi.fn(),
  renameSheet: vi.fn(),
  deleteSheet: vi.fn(),
  changeSheetStructure: vi.fn(),
  updateCells: vi.fn(),
  transferRange: vi.fn(),
  restoreSheet: vi.fn(),
  setSheetSelection: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, ...api };
});

function updatedWorkbook(cells: Record<string, { value: string; formula?: string }>) {
  return {
    ...seededWorkbook,
    sheets: [
      { ...seededWorkbook.sheets[0], cells: { ...seededWorkbook.sheets[0].cells, ...cells } },
      seededWorkbook.sheets[1],
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHistory("wb-seed-q3");
  clearHistory("wb-other");
  clearClipboardBuffer();
  setLastExternalText(null);
  window.location.hash = "#/workbook/wb-seed-q3";
  api.getWorkbook.mockResolvedValue(seededWorkbook);
  api.setSheetSelection.mockResolvedValue({} as never);
  api.updateCells.mockResolvedValue({} as never);
  api.restoreSheet.mockImplementation(async (_id: string, _sheetId: string, snapshot: { cells: Record<string, { value: string; formula?: string }> }) =>
    updatedWorkbook(snapshot.cells),
  );
});

describe("EditorPage", () => {

  it("renders the workbook name, last updated, formula bar and toolbar", async () => {
    render(<EditorPage workbookId="wb-seed-q3" />);

    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeInTheDocument();
    expect(screen.getByText(/^Last updated: /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename workbook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Region");
  });

  it("renders worksheet tabs in order with aria-selected and the ARIA grid", async () => {
    render(<EditorPage workbookId="wb-seed-q3" />);

    const sheet1Tab = await screen.findByRole("tab", { name: "Sheet1" });
    const sheet2Tab = screen.getByRole("tab", { name: "Sheet2" });
    expect(sheet1Tab).toHaveAttribute("aria-selected", "true");
    expect(sheet2Tab).toHaveAttribute("aria-selected", "false");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid).toHaveAttribute("aria-multiselectable", "true");

    const cellA1 = screen.getByRole("gridcell", { name: "A1" });
    expect(cellA1).toHaveTextContent("Region");
    expect(cellA1).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveAttribute("aria-selected", "false");
  });

  it("provides per-tab options buttons and the Add worksheet button", async () => {
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    expect(screen.getByRole("button", { name: "Worksheet options for Sheet1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worksheet options for Sheet2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add worksheet" })).toBeInTheDocument();
  });

  it("shows seeded headers and rows in the grid and their content in the formula bar", async () => {
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Sales");
    const c1 = screen.getByRole("gridcell", { name: "C1" });
    expect(c1).toHaveTextContent("Status");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveTextContent("Open");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.getByRole("gridcell", { name: "B4" })).toHaveTextContent("700");
    expect(screen.getByRole("gridcell", { name: "C4" })).toHaveTextContent("Open");

    await userEvent.setup().click(c1);
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Status");

    await userEvent.setup().click(screen.getByRole("gridcell", { name: "B2" }));
    expect(screen.getByLabelText("Formula bar")).toHaveValue("1200");
  });

  it("displays formula error values while the formula bar keeps the submitted formula", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(updatedWorkbook({ E1: { value: "#DIV/0!", formula: "=1/0" } }));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "=1/0");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("#DIV/0!"));
    expect(formulaBar).toHaveValue("=1/0");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
  });

  it("selecting another cell updates the selected region and formula bar", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "C2" }));

    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Open");
    await waitFor(() =>
      expect(api.setSheetSelection).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        start: { row: 2, column: 3 },
        end: { row: 2, column: 3 },
      }),
    );
  });

  it("persists a selection immediately so it survives an immediate reload", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    // The save must be dispatched synchronously with the selection change, not
    // deferred to a later timer that a page reload could cancel.
    await user.click(screen.getByRole("gridcell", { name: "E2" }));
    expect(api.setSheetSelection).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
      start: { row: 2, column: 5 },
      end: { row: 2, column: 5 },
    });
  });

  it("renames the workbook through the dialog and updates the title", async () => {
    const user = userEvent.setup();
    const renamed = { ...seededWorkbook, name: "FY25 Sales", updatedAt: "2026-09-03T08:00:00.000Z" };
    api.renameWorkbook.mockResolvedValue(renamed);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));

    const textbox = screen.getByLabelText("Workbook name");
    expect(textbox).toHaveValue("Q3 Sales");
    await user.clear(textbox);
    await user.type(textbox, "FY25 Sales");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "FY25 Sales" })).toBeInTheDocument());
    expect(api.renameWorkbook).toHaveBeenCalledWith("wb-seed-q3", "FY25 Sales");
  });

  it("rejects an empty workbook name beside the control", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const textbox = screen.getByLabelText("Workbook name");
    await user.clear(textbox);
    await user.type(textbox, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Workbook name cannot be empty");
    expect(api.renameWorkbook).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeInTheDocument();
  });

  it("exports the active worksheet via a download anchor", async () => {
    const user = userEvent.setup();
    const captures: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        captures.push(this);
      });
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(clickSpy).toHaveBeenCalled();
    expect(captures[0]?.href).toMatch(/\/api\/workbooks\/wb-seed-q3\/export$/);
    expect(captures[0]?.download).toBe("Q3 Sales.csv");
    clickSpy.mockRestore();
  });

  it("adds a worksheet, activates it and selects A1", async () => {
    const user = userEvent.setup();
    const added: typeof seededWorkbook = {
      ...seededWorkbook,
      activeSheetId: "ws-seed-q3-3",
      sheets: [...seededWorkbook.sheets, { id: "ws-seed-q3-3", name: "Sheet3", cells: {} }],
    };
    api.addWorksheet.mockResolvedValue(added);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const sheet3Tab = await screen.findByRole("tab", { name: "Sheet3" });
    expect(sheet3Tab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("");
    expect(api.addWorksheet).toHaveBeenCalledWith("wb-seed-q3");
  });

  it("keeps existing tabs unchanged when adding a worksheet fails", async () => {
    const user = userEvent.setup();
    api.addWorksheet.mockRejectedValue(new Error("boom"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByRole("tab", { name: "Sheet3" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
  });

  it("renames a worksheet through the tab menu and updates the tab", async () => {
    const user = userEvent.setup();
    const renamed = {
      ...seededWorkbook,
      sheets: [{ ...seededWorkbook.sheets[0], name: "Data" }, seededWorkbook.sheets[1]],
    };
    api.renameSheet.mockResolvedValue(renamed);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const dialog = screen.getByRole("dialog", { name: "Rename worksheet" });
    const textbox = screen.getByLabelText("Worksheet name");
    expect(textbox).toHaveValue("Sheet1");
    await user.clear(textbox);
    await user.type(textbox, "Data");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: "Sheet1" })).not.toBeInTheDocument();
    expect(api.renameSheet).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", "Data");
  });

  it("shows an error and keeps the original name when the worksheet name is empty", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const textbox = screen.getByLabelText("Worksheet name");
    await user.clear(textbox);
    await user.type(textbox, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Worksheet name cannot be empty");
    expect(api.renameSheet).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
  });

  it("shows the duplicate error beside the control and keeps the original name", async () => {
    const user = userEvent.setup();
    api.renameSheet.mockRejectedValue(new Error("Worksheet name already exists"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const textbox = screen.getByLabelText("Worksheet name");
    await user.clear(textbox);
    await user.type(textbox, "Sheet2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Worksheet name already exists");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
  });

  it("provides a Delete command in the worksheet tab menu", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("opens the Delete worksheet dialog naming the target and deletes it on confirm", async () => {
    const user = userEvent.setup();
    const afterDelete: typeof seededWorkbook = {
      ...seededWorkbook,
      activeSheetId: "ws-seed-q3-2",
      sheets: [seededWorkbook.sheets[1]],
    };
    api.deleteSheet.mockResolvedValue(afterDelete);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", { name: "Delete worksheet" });
    expect(dialog).toHaveTextContent("Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(api.deleteSheet).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1"));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet1" })).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("");
  });

  it("does not open a confirmation dialog when deleting the only worksheet", async () => {
    const user = userEvent.setup();
    const single: typeof seededWorkbook = {
      ...seededWorkbook,
      sheets: [{ id: "ws-seed-q3-1", name: "Sheet1", cells: {} }],
    };
    api.getWorkbook.mockResolvedValue(single);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("A workbook must contain at least one worksheet");
    expect(api.deleteSheet).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes the dialog and shows the error when the target is a pivot source worksheet", async () => {
    const user = userEvent.setup();
    api.deleteSheet.mockRejectedValue(new Error("Please delete or rebuild dependent pivot tables first"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please delete or rebuild dependent pivot tables first");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).not.toBeInTheDocument());
    // The target tab and its grid remain visible and unchanged.
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
  });

  it("keeps the target tab and grid visible when a deletion fails", async () => {
    const user = userEvent.setup();
    api.deleteSheet.mockRejectedValue(new Error("Deletion failed"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("tab", { name: "Sheet1" });

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Deletion failed");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveTextContent("800");
  });


  it("inserts a row above through the row-number menu", async () => {
    const user = userEvent.setup();
    const shifted = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          cells: {
            A2: { value: "2" },
            B2: { value: "3" },
            C2: { value: "5", formula: "=A2+B2" },
            D2: { value: "10", formula: "=C2*2" },
          },
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.changeSheetStructure.mockResolvedValue(shifted);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));

    expect(api.changeSheetStructure).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", "insert-row-above", 1);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("2"));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("");
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveTextContent("5");
  });

  it("deletes a row through the row-number menu", async () => {
    const user = userEvent.setup();
    const shifted = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          cells: {},
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.changeSheetStructure.mockResolvedValue(shifted);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));

    expect(api.changeSheetStructure).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", "delete-row", 1);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent(""));
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("");
  });

  it("inserts a column left through the column-header menu", async () => {
    const user = userEvent.setup();
    const shifted = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          cells: {
            A1: { value: "2" },
            C1: { value: "3" },
            D1: { value: "5", formula: "=A1+C1" },
            E1: { value: "10", formula: "=D1*2" },
          },
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.changeSheetStructure.mockResolvedValue(shifted);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 column left" }));

    expect(api.changeSheetStructure).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", "insert-column-left", 2);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("3"));
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("5");
  });

  it("deletes a column through the column-header menu", async () => {
    const user = userEvent.setup();
    const shifted = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          cells: {
            A1: { value: "2" },
            B1: { value: "3" },
            C1: { value: "5", formula: "=A1+B1" },
          },
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.changeSheetStructure.mockResolvedValue(shifted);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "D" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Delete column" }));

    expect(api.changeSheetStructure).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", "delete-column", 4);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("5");
  });

  it("shows an error and keeps the grid unchanged when a structure operation fails", async () => {
    const user = userEvent.setup();
    api.changeSheetStructure.mockRejectedValue(new Error("Operation failed"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Operation failed");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
  });

  it("commits a value typed in the formula bar and updates the grid", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(updatedWorkbook({ D1: { value: "East" } }));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "East");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(api.updateCells).toHaveBeenCalledTimes(1);
    expect(api.updateCells).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", { D1: "East" });
  });

  it("shows a formula result in the grid and the original formula in the formula bar", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(updatedWorkbook({ C1: { value: "5", formula: "=B2+1" } }));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "=B2+1");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("5"));
    expect(screen.getByRole("gridcell", { name: "C1" })).not.toHaveTextContent("=B2+1");
    expect(formulaBar).toHaveValue("=B2+1");
  });

  it("cancels an uncommitted formula bar change with Escape", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "East");
    await user.keyboard("{Escape}");

    expect(api.updateCells).not.toHaveBeenCalled();
    expect(formulaBar).toHaveValue("Region");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
  });

  it("shows an error and keeps the last successful value when a commit fails", async () => {
    const user = userEvent.setup();
    api.updateCells.mockRejectedValue(new Error("Invalid formula"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "=1+");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid formula");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(formulaBar).toHaveValue("Region");
  });

  it("double-clicking a grid cell opens the inline editor named Edit <coordinate>", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(updatedWorkbook({ A1: { value: "Product" } }));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.dblClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = screen.getByLabelText("Edit A1");
    expect(editor).toHaveValue("Region");

    await user.clear(editor);
    await user.type(editor, "Product");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Product"));
    expect(api.updateCells).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", { A1: "Product" });
  });

  it("Escape cancels an uncommitted grid edit", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.dblClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = screen.getByLabelText("Edit A1");
    await user.clear(editor);
    await user.type(editor, "Product");
    await user.keyboard("{Escape}");

    expect(api.updateCells).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Edit A1")).not.toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
  });

  it("dragging selects a rectangle and updates aria-selected on every gridcell", async () => {
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseMove(screen.getByRole("gridcell", { name: "B2" }), { bubbles: true });
    fireEvent.mouseUp(screen.getByRole("gridcell", { name: "B2" }));

    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("gridcell", { name: "A3" })).toHaveAttribute("aria-selected", "false");
    await waitFor(() =>
      expect(api.setSheetSelection).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        start: { row: 1, column: 1 },
        end: { row: 2, column: 2 },
      }),
    );
  });

  it("restores the persisted per-sheet selection after reload", async () => {
    const withSelection = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          selection: { start: { row: 1, column: 4 }, end: { row: 2, column: 5 } },
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.getWorkbook.mockResolvedValue(withSelection);
    render(<EditorPage workbookId="wb-seed-q3" />);

    await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("");
  });

  it("copies and pastes a range with Ctrl+C and Ctrl+V", async () => {
    const user = userEvent.setup();
    api.transferRange.mockResolvedValue(
      updatedWorkbook({ D1: { value: "2" }, E1: { value: "3" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseMove(screen.getByRole("gridcell", { name: "B2" }), { bubbles: true });
    fireEvent.mouseUp(screen.getByRole("gridcell", { name: "B2" }));
    screen.getByRole("gridcell", { name: "A1" }).focus();

    await user.keyboard("{Control>}c{/Control}");

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() =>
      expect(api.transferRange).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        source: { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } },
        target: { start: { row: 1, column: 4 }, end: { row: 1, column: 4 } },
        mode: "copy",
      }),
    );
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("3"));
  });

  it("provides Copy, Cut and Paste commands in the grid cell context menu", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "A1" }), { clientX: 10, clientY: 20 });

    const pasteItem = await screen.findByRole("menuitem", { name: "Paste" });
    expect(pasteItem).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Cut" })).toBeInTheDocument();
    void user;
  });

  it("pastes through the menu Paste command after copying", async () => {
    const user = userEvent.setup();
    api.transferRange.mockResolvedValue(
      updatedWorkbook({ D1: { value: "2" }, E1: { value: "3" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseMove(screen.getByRole("gridcell", { name: "B2" }), { bubbles: true });
    fireEvent.mouseUp(screen.getByRole("gridcell", { name: "B2" }));

    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "A1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Copy" }));

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() =>
      expect(api.transferRange).toHaveBeenCalledWith(
        "wb-seed-q3",
        "ws-seed-q3-1",
        expect.objectContaining({ mode: "copy", source: { start: { row: 1, column: 1 }, end: { row: 2, column: 2 } } }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("3"));
  });

  it("pastes external clipboard content through the context menu Paste command", async () => {
    const user = userEvent.setup();
    const readText = vi.fn().mockResolvedValue("East\t1200\nNorth\t800");
    Object.defineProperty(window.navigator, "clipboard", { value: { readText }, configurable: true });
    api.updateCells.mockResolvedValue(
      updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() =>
      expect(api.updateCells).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        D1: "East",
        E1: "1200",
        D2: "North",
        E2: "800",
      }),
    );
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800"));
    expect(readText).toHaveBeenCalled();
    delete (window.navigator as unknown as Record<string, unknown>).clipboard;
  });

  it("preserves empty fields when pasting external clipboard text via the context menu", async () => {
    const user = userEvent.setup();
    const readText = vi.fn().mockResolvedValue("East\t1200\t\nNorth\t800\t");
    Object.defineProperty(window.navigator, "clipboard", { value: { readText }, configurable: true });
    api.updateCells.mockResolvedValue(
      updatedWorkbook({
        D1: { value: "East" },
        E1: { value: "1200" },
        F1: { value: "" },
        D2: { value: "North" },
        E2: { value: "800" },
        F2: { value: "" },
      }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() =>
      expect(api.updateCells).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        D1: "East",
        E1: "1200",
        F1: "",
        D2: "North",
        E2: "800",
        F2: "",
      }),
    );
    delete (window.navigator as unknown as Record<string, unknown>).clipboard;
  });

  it("pastes tab-separated clipboard text into the starting cell", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(
      updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const clipboardData = {
      getData: (type: string) => (type === "text/plain" ? "East\t1200\nNorth\t800" : ""),
    } as unknown as DataTransfer;
    fireEvent.paste(screen.getByRole("gridcell", { name: "D1" }), { clipboardData });

    await waitFor(() =>
      expect(api.updateCells).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        D1: "East",
        E1: "1200",
        D2: "North",
        E2: "800",
      }),
    );
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800"));
  });

  it("keeps the previous sheet selection when switching worksheets", async () => {
    const user = userEvent.setup();
    api.setActiveSheet.mockResolvedValue({ ...seededWorkbook, activeSheetId: "ws-seed-q3-2" });
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.mouseMove(screen.getByRole("gridcell", { name: "E2" }), { bubbles: true });
    fireEvent.mouseUp(screen.getByRole("gridcell", { name: "E2" }));

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the grid, formula bar and selection to the target worksheet without modifying the source", async () => {
    const user = userEvent.setup();
    api.setActiveSheet.mockResolvedValue({ ...seededWorkbook, activeSheetId: "ws-seed-q3-2" });
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "false");
    expect(api.setActiveSheet).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-2");
    // The blank target worksheet shows no seeded data; first open with no
    // selection history selects A1 and the formula bar is empty.
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("");
    // Switching only persists the active tab: the source sheet data is untouched.
    expect(api.updateCells).not.toHaveBeenCalled();
  });

  it("restores the previous worksheet's confirmed selection and formula bar when switching back", async () => {
    const user = userEvent.setup();
    api.setActiveSheet.mockResolvedValue({ ...seededWorkbook, activeSheetId: "ws-seed-q3-2" });
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Open");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "true");

    api.setActiveSheet.mockResolvedValue({ ...seededWorkbook, activeSheetId: "ws-seed-q3-1" });
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Open");
  });

  it("shows the original formula of the selected cell on the target worksheet in the formula bar", async () => {
    const user = userEvent.setup();
    const withFormula: typeof seededWorkbook = {
      ...seededWorkbook,
      sheets: [
        seededWorkbook.sheets[0],
        {
          id: "ws-seed-q3-2",
          name: "Sheet2",
          cells: { A1: { value: "5", formula: "=1+4" }, B1: { value: "7", formula: "=A1+2" } },
        },
      ],
    };
    api.setActiveSheet.mockResolvedValue({ ...withFormula, activeSheetId: "ws-seed-q3-2" });
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("5");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("=1+4");

    await user.click(screen.getByRole("gridcell", { name: "B1" }));
    expect(screen.getByLabelText("Formula bar")).toHaveValue("=A1+2");
  });

  it("keeps the previous tab, its selection and formula bar when switching fails", async () => {
    const user = userEvent.setup();
    api.setActiveSheet.mockRejectedValue(new Error("Worksheet not found"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await user.click(screen.getByRole("gridcell", { name: "C2" }));

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Open");
    expect(await screen.findByRole("alert")).toHaveTextContent("Worksheet not found");
  });

  it("reopening displays the last active tab and restores each worksheet's confirmed selection", async () => {
    const user = userEvent.setup();
    const reopened: typeof seededWorkbook = {
      ...seededWorkbook,
      activeSheetId: "ws-seed-q3-2",
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          selection: { start: { row: 2, column: 3 }, end: { row: 2, column: 3 } },
        },
        {
          ...seededWorkbook.sheets[1],
          selection: { start: { row: 3, column: 2 }, end: { row: 3, column: 2 } },
        },
      ],
    };
    api.getWorkbook.mockResolvedValue(reopened);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    // The last active tab is displayed directly together with its selection.
    expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "B3" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");

    // Switching back restores Sheet1's last confirmed selection.
    api.setActiveSheet.mockResolvedValue({ ...reopened, activeSheetId: "ws-seed-q3-1" });
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "C2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("Formula bar")).toHaveValue("Open");
  });
});

describe("undo and redo", () => {
  function pasteTable(into: string) {
    return async () => {
      const user = userEvent.setup();
      await user.click(screen.getByRole("gridcell", { name: into }));
      const clipboardData = {
        getData: (type: string) => (type === "text/plain" ? "East\t1200\nNorth\t800" : ""),
      } as unknown as DataTransfer;
      fireEvent.paste(screen.getByRole("gridcell", { name: into }), { clipboardData });
      await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800"));
      return user;
    };
  }

  it("provides Undo and Redo toolbar buttons, disabled when there is no history", async () => {
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeInTheDocument();
    expect(redo).toBeInTheDocument();
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("undoes and redoes a bulk paste into the D1:E2 target range", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(
      updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await pasteTable("D1")();

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800");
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    await user.click(undo);

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("");
    expect(api.restoreSheet).toHaveBeenCalledTimes(1);
    const [restoredId, restoredSheetId, beforeSnapshot] = api.restoreSheet.mock.calls[0];
    expect(restoredId).toBe("wb-seed-q3");
    expect(restoredSheetId).toBe("ws-seed-q3-1");
    expect(beforeSnapshot.cells.D1).toBeUndefined();
    expect(beforeSnapshot.cells.E2).toBeUndefined();
    expect(beforeSnapshot.cells.A1.value).toBe("Region");
    // The seeded row is unchanged after undo.
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Sales");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");

    const redo = screen.getByRole("button", { name: "Redo" });
    expect(redo).toBeEnabled();
    await user.click(redo);

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("1200");
    expect(screen.getByRole("gridcell", { name: "D2" })).toHaveTextContent("North");
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800");
    expect(api.restoreSheet).toHaveBeenCalledTimes(2);
    const [, , afterSnapshot] = api.restoreSheet.mock.calls[1];
    expect(afterSnapshot.cells.D1.value).toBe("East");
    expect(afterSnapshot.cells.E2.value).toBe("800");
    // A new modification re-applied through redo keeps Undo available.
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("undoes with Ctrl+Z and redoes with Ctrl+Y", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(
      updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await pasteTable("D1")();

    screen.getByRole("gridcell", { name: "D1" }).focus();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(api.restoreSheet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));

    screen.getByRole("gridcell", { name: "D1" }).focus();
    await user.keyboard("{Control>}y{/Control}");
    await waitFor(() => expect(api.restoreSheet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(screen.getByRole("gridcell", { name: "E2" })).toHaveTextContent("800");
  });

  it("disables Redo and drops the old branch after a new modification following an undo", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(
      updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await pasteTable("D1")();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(redo).toBeEnabled();

    // New modification after the undo: redo branch is dropped.
    api.updateCells.mockResolvedValue(updatedWorkbook({ D1: { value: "New" } }));
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "New");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("New"));

    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    // Ctrl+Y must not restore the old branch (the only restore call so far
    // is the Undo click above; Ctrl+Y must not add another).
    screen.getByRole("gridcell", { name: "D1" }).focus();
    await user.keyboard("{Control>}y{/Control}");
    expect(api.restoreSheet).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("New");
  });

  it("restores consecutive operations in reverse order", async () => {
    const user = userEvent.setup();
    api.updateCells
      .mockResolvedValueOnce(
        updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
      )
      .mockResolvedValueOnce(
        updatedWorkbook({
          D1: { value: "East" },
          E1: { value: "1200" },
          D2: { value: "North" },
          E2: { value: "800" },
          A5: { value: "East" },
          B5: { value: "1200" },
          A6: { value: "North" },
          B6: { value: "800" },
        }),
      );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await pasteTable("D1")();
    // Second paste anchored at A5 overwrites a second rectangle.
    const user2 = userEvent.setup();
    await user2.click(screen.getByRole("gridcell", { name: "A5" }));
    fireEvent.paste(screen.getByRole("gridcell", { name: "A5" }), {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "East\t1200\nNorth\t800" : ""),
      },
    } as unknown as DataTransfer);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B6" })).toHaveTextContent("800"));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A5" })).toHaveTextContent(""));
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Sales");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("undoes a row structure change back to the pre-operation layout", async () => {
    const user = userEvent.setup();
    const shifted = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          cells: {
            A2: { value: "2" },
            B2: { value: "3" },
            C2: { value: "5", formula: "=A2+B2" },
            D2: { value: "10", formula: "=C2*2" },
          },
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.changeSheetStructure.mockResolvedValue(shifted);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }), { clientX: 10, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("2"));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region"));
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Sales");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("");
    expect(api.restoreSheet).toHaveBeenCalledTimes(1);
  });

  it("records no undo entry when a commit fails", async () => {
    const user = userEvent.setup();
    api.updateCells.mockRejectedValue(new Error("Please enter a number from 0 to 100"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "1200");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a number from 0 to 100");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(api.restoreSheet).not.toHaveBeenCalled();
  });

  it("keeps the undone entry available when the restore fails", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(
      updatedWorkbook({ D1: { value: "East" }, E1: { value: "1200" }, D2: { value: "North" }, E2: { value: "800" } }),
    );
    api.restoreSheet.mockRejectedValue(new Error("Restore failed"));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await pasteTable("D1")();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Restore failed");
    // The operation was not undone, so the grid keeps its current values and
    // the entry stays on the undo stack for a retry.
    expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("does not share undo history between different workbooks", async () => {
    const user = userEvent.setup();
    const otherWorkbook = {
      ...seededWorkbook,
      id: "wb-other",
      name: "Other workbook",
      activeSheetId: "ws-other-1",
      sheets: [{ id: "ws-other-1", name: "Sheet1", cells: {} }],
    };
    api.getWorkbook.mockImplementation(async (id: string) => (id === "wb-other" ? otherWorkbook : seededWorkbook));
    api.updateCells.mockResolvedValue(updatedWorkbook({ D1: { value: "East" } }));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "East");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("East"));
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    const { unmount } = render(<EditorPage workbookId="wb-other" />);
    await screen.findByRole("heading", { name: "Other workbook" });
    const otherEditor = (await screen.findByRole("heading", { name: "Other workbook" })).closest("main") as HTMLElement;
    expect(within(otherEditor).getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(within(otherEditor).getByRole("button", { name: "Redo" })).toBeDisabled();
    unmount();
  });

  it("undoes a cell edit and redoes the original formula", async () => {
    const user = userEvent.setup();
    api.updateCells.mockResolvedValue(updatedWorkbook({ D1: { value: "5", formula: "=1+4" } }));
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByLabelText("Formula bar");
    await user.clear(formulaBar);
    await user.type(formulaBar, "=1+4");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("5"));
    // The formula bar keeps showing the submitted formula.
    expect(screen.getByLabelText("Formula bar")).toHaveValue("=1+4");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));
    expect(screen.getByLabelText("Formula bar")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent("5"));
    expect(screen.getByLabelText("Formula bar")).toHaveValue("=1+4");
    const [, , afterSnapshot] = api.restoreSheet.mock.calls[1];
    expect(afterSnapshot.cells.D1).toEqual({ value: "5", formula: "=1+4" });
  });

  it("undoes a copy-paste range transfer and keeps the source range", async () => {
    const user = userEvent.setup();
    api.transferRange.mockResolvedValue(
      updatedWorkbook({ D1: { value: "2" }, E1: { value: "3" } }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    fireEvent.mouseDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.mouseMove(screen.getByRole("gridcell", { name: "B2" }), { bubbles: true });
    fireEvent.mouseUp(screen.getByRole("gridcell", { name: "B2" }));
    screen.getByRole("gridcell", { name: "A1" }).focus();

    await user.keyboard("{Control>}c{/Control}");
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("3"));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toHaveTextContent(""));
    expect(screen.getByRole("gridcell", { name: "E1" })).toHaveTextContent("");
    // Cells outside the pasted rectangle (the source A1:B1) stay unchanged.
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("Sales");
    expect(screen.getByRole("gridcell", { name: "C1" })).toHaveTextContent("Status");
    expect(api.restoreSheet).toHaveBeenCalledTimes(1);
  });
});
