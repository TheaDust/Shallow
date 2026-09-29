import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditorPage } from "./EditorPage";
import { clearHistory } from "../domain/history";
import { clearClipboardBuffer, setLastExternalText } from "../domain/clipboard";
import { seededWorkbook } from "../test/fixtures";
import type { Workbook } from "../domain/types";

const api = vi.hoisted(() => ({
  listWorkbooks: vi.fn(),
  createWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  renameWorkbook: vi.fn(),
  setActiveSheet: vi.fn(),
  importWorkbook: vi.fn(),
  addWorksheet: vi.fn(),
  renameSheet: vi.fn(),
  changeSheetStructure: vi.fn(),
  updateCells: vi.fn(),
  transferRange: vi.fn(),
  restoreSheet: vi.fn(),
  setSheetSelection: vi.fn(),
  setFilter: vi.fn(),
  createPivot: vi.fn(),
  applyPivot: vi.fn(),
  refreshPivot: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, ...api };
});

function withFilterSheet(workbook: Workbook, cells: Record<string, { value: string; formula?: string }>, filterViews: unknown[]) {
  return {
    ...workbook,
    sheets: [{ ...workbook.sheets[0], cells, filterViews }, ...workbook.sheets.slice(1)],
  };
}

function withPivotSheet(workbook: Workbook, pivot: unknown, cells: Record<string, { value: string }> = {}) {
  return {
    ...workbook,
    activeSheetId: "ws-pivot-1",
    sheets: [
      workbook.sheets[0],
      ...workbook.sheets.slice(1),
      { id: "ws-pivot-1", name: "Pivot1", cells, pivot },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHistory("wb-seed-q3");
  clearClipboardBuffer();
  setLastExternalText(null);
  window.location.hash = "#/workbook/wb-seed-q3";
  api.getWorkbook.mockResolvedValue(seededWorkbook);
  api.setSheetSelection.mockResolvedValue({} as never);
  api.setFilter.mockResolvedValue({} as never);
  api.createPivot.mockResolvedValue({} as never);
  api.applyPivot.mockResolvedValue({} as never);
  api.refreshPivot.mockResolvedValue({} as never);
});

describe("Data menu and filtering", () => {
  it("provides a Data toolbar button whose commands use the menuitem role", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const dataButton = screen.getByRole("button", { name: "Data" });
    expect(dataButton).toBeInTheDocument();

    await user.click(dataButton);
    expect(screen.getByRole("menuitem", { name: "Create filter" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Create pivot table" })).toBeInTheDocument();
    const clearFilter = screen.getByRole("menuitem", { name: "Clear filter" });
    expect(clearFilter).toBeDisabled();
  });

  it("creates a filter over the selected range and renders Filter <header> buttons", async () => {
    const user = userEvent.setup();
    api.setFilter.mockResolvedValue(
      withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
        {
          id: "f1",
          range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
          conditions: [],
        },
      ]),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));

    await waitFor(() =>
      expect(api.setFilter).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
      }),
    );
    expect(await screen.findByRole("button", { name: "Filter Region" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeInTheDocument();
  });

  it("filters by selected values: checkboxes use source values, Apply hides nonmatching rows", async () => {
    const user = userEvent.setup();
    const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };
    api.setFilter
      .mockResolvedValueOnce(
        withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [{ id: "f1", range, conditions: [] }]),
      )
      .mockResolvedValueOnce(
        withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
          { id: "f1", range, conditions: [{ column: 1, mode: "values", values: ["East"] }] },
        ]),
      );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });

    const east = within(dialog).getByRole("checkbox", { name: "East" });
    const north = within(dialog).getByRole("checkbox", { name: "North" });
    const south = within(dialog).getByRole("checkbox", { name: "South" });
    expect(east).toBeChecked();
    expect(north).toBeChecked();
    expect(south).toBeChecked();

    await user.click(north);
    await user.click(south);
    await user.click(within(dialog).getAllByRole("button", { name: "Apply" })[0]);

    await waitFor(() =>
      expect(api.setFilter).toHaveBeenLastCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        range,
        conditions: [{ column: 1, mode: "values", values: ["East", ""] }],
      }),
    );
    // With the mocked response the sheet now hides rows 3 and 4.
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).not.toBeInTheDocument());
    expect(screen.getByRole("gridcell", { name: "A2" })).toHaveTextContent("East");
    expect(screen.queryByRole("gridcell", { name: "A4" })).not.toBeInTheDocument();
  });

  it("Clear selection unchecks every checkbox before Apply", async () => {
    const user = userEvent.setup();
    const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };
    api.setFilter
      .mockResolvedValueOnce(
        withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [{ id: "f1", range, conditions: [] }]),
      )
      .mockResolvedValueOnce(
        withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
          { id: "f1", range, conditions: [{ column: 1, mode: "values", values: [] }] },
        ]),
      );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });

    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    expect(within(dialog).getByRole("checkbox", { name: "East" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "North" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "South" })).not.toBeChecked();

    await user.click(within(dialog).getAllByRole("button", { name: "Apply" })[0]);
    await waitFor(() =>
      expect(api.setFilter).toHaveBeenLastCalledWith(
        "wb-seed-q3",
        "ws-seed-q3-1",
        expect.objectContaining({ conditions: [{ column: 1, mode: "values", values: [] }] }),
      ),
    );
  });

  it("applies a condition through the Condition/Value controls and combines with values", async () => {
    const user = userEvent.setup();
    const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };
    api.setFilter
      .mockResolvedValueOnce(
        withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
          { id: "f1", range, conditions: [{ column: 1, mode: "values", values: ["East", "North"] }] },
        ]),
      )
      .mockResolvedValueOnce(
        withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
          { id: "f1", range, conditions: [{ column: 1, mode: "values", values: ["East", "North"] }] },
        ]),
      );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    // Open the Region dialog and close it, then open the Sales dialog.
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(await screen.findByRole("button", { name: "Filter Sales" }));

    const dialog = screen.getByRole("dialog", { name: "Filter Sales" });
    const conditionBox = within(dialog).getByLabelText("Condition");
    expect(conditionBox).toBeInTheDocument();
    const options = within(conditionBox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Text contains",
      "Greater than",
      "Before",
      "Is empty",
      "Is not empty",
    ]);
    const valueBox = within(dialog).getByLabelText("Value");

    await user.selectOptions(conditionBox, "greater-than");
    await user.type(valueBox, "800");
    await user.click(within(dialog).getAllByRole("button", { name: "Apply" })[1]);

    await waitFor(() =>
      expect(api.setFilter).toHaveBeenLastCalledWith(
        "wb-seed-q3",
        "ws-seed-q3-1",
        expect.objectContaining({
          conditions: [
            { column: 1, mode: "values", values: ["East", "North"] },
            { column: 2, mode: "condition", condition: "greater-than", value: "800" },
          ],
        }),
      ),
    );
  });

  it("Is empty and Is not empty disable the Value text box", async () => {
    const user = userEvent.setup();
    api.setFilter.mockResolvedValue(
      withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
        { id: "f1", range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } }, conditions: [] },
      ]),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(await screen.findByRole("button", { name: "Filter Status" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Status" });

    await user.selectOptions(within(dialog).getByLabelText("Condition"), "is-empty");
    expect(within(dialog).getByLabelText("Value")).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Condition"), "text-contains");
    expect(within(dialog).getByLabelText("Value")).toBeEnabled();
  });

  it("Clear filter restores every row and all header buttons disappear", async () => {
    const user = userEvent.setup();
    const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };
    const withEast = withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, [
      { id: "f1", range, conditions: [{ column: 1, mode: "values", values: ["East", ""] }] },
    ]);
    api.setFilter.mockResolvedValueOnce(withEast).mockResolvedValueOnce(withEast);
    api.setFilter.mockResolvedValueOnce(
      withFilterSheet(seededWorkbook, seededWorkbook.sheets[0].cells, []),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getAllByRole("button", { name: "Apply" })[0]);
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear filter" }));

    await waitFor(() => expect(api.setFilter).toHaveBeenLastCalledWith("wb-seed-q3", "ws-seed-q3-1", { clear: true }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" })).toHaveTextContent("North"));
    expect(screen.getByRole("gridcell", { name: "A4" })).toHaveTextContent("South");
    expect(screen.queryByRole("button", { name: "Filter Region" })).not.toBeInTheDocument();
  });
});

describe("pivot table creation and editor", () => {
  function pivotConfig() {
    return {
      sourceSheetId: "ws-seed-q3-1",
      sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
      rowField: "Region",
      rowFieldColumn: 1,
      columnField: null,
      columnFieldColumn: null,
      valueField: "Sales",
      valueFieldColumn: 2,
      summarizeBy: "SUM",
      resultRange: { start: { row: 1, column: 1 }, end: { row: 5, column: 2 } },
      broken: false,
      lastError: null,
    };
  }

  it("opens the Create pivot table dialog with the source range and New worksheet radio", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));

    const dialog = screen.getByRole("dialog", { name: "Create pivot table" });
    expect(dialog).toHaveTextContent("Source range: A1:A1");
    const radio = within(dialog).getByRole("radio", { name: "New worksheet" });
    expect(radio).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("creates Pivot1, activates it and renders the Pivot table editor region", async () => {
    const user = userEvent.setup();
    api.createPivot.mockResolvedValue(
      withPivotSheet(seededWorkbook, {
        sourceSheetId: "ws-seed-q3-1",
        sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
        rowField: "",
        rowFieldColumn: null,
        columnField: null,
        columnFieldColumn: null,
        valueField: "",
        valueFieldColumn: null,
        summarizeBy: "SUM",
        resultRange: null,
        broken: false,
        lastError: null,
      }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.createPivot).toHaveBeenCalledWith("wb-seed-q3", {
        sourceSheetId: "ws-seed-q3-1",
        sourceRange: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
      }),
    );
    const tab = await screen.findByRole("tab", { name: "Pivot1" });
    expect(tab).toHaveAttribute("aria-selected", "true");

    const editor = screen.getByRole("region", { name: "Pivot table editor" });
    const rows = within(editor).getByLabelText("Rows");
    const columns = within(editor).getByLabelText("Columns");
    const values = within(editor).getByLabelText("Values");
    const summarize = within(editor).getByLabelText("Summarize by");
    expect(within(rows).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "(None)",
      "Region",
      "Sales",
      "Status",
    ]);
    expect(within(values).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "(None)",
      "Region",
      "Sales",
      "Status",
    ]);
    expect(within(summarize).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "SUM",
      "COUNT",
      "AVERAGE",
    ]);
    expect(within(editor).getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Refresh pivot table" })).toBeInTheDocument();
  });

  it("applies Rows/Values/Summarize by and renders the pivot result grid", async () => {
    const user = userEvent.setup();
    api.createPivot.mockResolvedValue(
      withPivotSheet(seededWorkbook, {
        sourceSheetId: "ws-seed-q3-1",
        sourceRange: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
        rowField: "",
        rowFieldColumn: null,
        columnField: null,
        columnFieldColumn: null,
        valueField: "",
        valueFieldColumn: null,
        summarizeBy: "SUM",
        resultRange: null,
        broken: false,
        lastError: null,
      }),
    );
    const resultCells = {
      A1: { value: "Region" },
      B1: { value: "SUM of Sales" },
      A2: { value: "East" },
      B2: { value: "1200" },
      A3: { value: "North" },
      B3: { value: "800" },
      A4: { value: "South" },
      B4: { value: "700" },
      A5: { value: "Grand Total" },
      B5: { value: "2700" },
    };
    api.applyPivot.mockResolvedValue(
      withPivotSheet(seededWorkbook, { ...pivotConfig(), rowField: "Region", valueField: "Sales" }, resultCells),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("tab", { name: "Pivot1" });

    const editor = screen.getByRole("region", { name: "Pivot table editor" });
    await user.selectOptions(within(editor).getByLabelText("Rows"), "Region");
    await user.selectOptions(within(editor).getByLabelText("Values"), "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.applyPivot).toHaveBeenCalledWith("wb-seed-q3", "ws-pivot-1", {
        rowField: "Region",
        columnField: null,
        valueField: "Sales",
        summarizeBy: "SUM",
      }),
    );
    expect(await screen.findByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B1" })).toHaveTextContent("SUM of Sales");
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700");
  });

  it("shows the field error when the pivot editor opens with a deleted source header", async () => {
    const brokenConfig = {
      ...pivotConfig(),
      rowField: "Region",
      valueField: "Sales",
      broken: true,
    };
    // The Sales header is gone from the source sheet's header row.
    const workbookWithMissingHeader = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          cells: {
            A1: { value: "Region" },
            B1: { value: "Status" },
            A2: { value: "East" },
            B2: { value: "Open" },
            A3: { value: "North" },
            B3: { value: "Closed" },
            A4: { value: "South" },
            B4: { value: "Open" },
          },
        },
        seededWorkbook.sheets[1],
        {
          id: "ws-pivot-1",
          name: "Pivot1",
          cells: {
            A1: { value: "Region" },
            B1: { value: "SUM of Sales" },
            A2: { value: "East" },
            B2: { value: "1200" },
            A5: { value: "Grand Total" },
            B5: { value: "2700" },
          },
          pivot: brokenConfig,
        },
      ],
      activeSheetId: "ws-pivot-1",
    };
    api.getWorkbook.mockResolvedValue(workbookWithMissingHeader);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(await within(editor).findByRole("alert")).toHaveTextContent(
      "Pivot field is no longer available. Select a new field.",
    );
    // The last successful result is preserved.
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("2700");
  });

  it("refresh re-applies the stored layout and displays the field error when the header is gone", async () => {
    const user = userEvent.setup();
    api.getWorkbook.mockResolvedValue(
      withPivotSheet(seededWorkbook, pivotConfig(), {
        A1: { value: "Region" },
        B1: { value: "SUM of Sales" },
        A2: { value: "East" },
        B2: { value: "1200" },
        A5: { value: "Grand Total" },
        B5: { value: "2700" },
      }),
    );
    api.refreshPivot.mockResolvedValue(
      withPivotSheet(seededWorkbook, pivotConfig(), {
        A1: { value: "Region" },
        B1: { value: "SUM of Sales" },
        A2: { value: "East" },
        B2: { value: "1500" },
        A5: { value: "Grand Total" },
        B5: { value: "3000" },
      }),
    );
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });
    await screen.findByRole("tab", { name: "Pivot1" });

    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(api.refreshPivot).toHaveBeenCalledWith("wb-seed-q3", "ws-pivot-1"));
    expect(await screen.findByRole("gridcell", { name: "B5" })).toHaveTextContent("3000");

    // Refresh failure: the API error is shown and the old result stays.
    api.refreshPivot.mockRejectedValue(new Error("Pivot field is no longer available. Select a new field."));
    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pivot field is no longer available. Select a new field.");
    expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("3000");
  });
});

describe("worksheet switching keeps per-sheet entry points", () => {
  it("shows filter buttons and dropdown entry points only for the active worksheet", async () => {
    const user = userEvent.setup();
    const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };
    const withState: typeof seededWorkbook = {
      ...seededWorkbook,
      sheets: [
        {
          ...seededWorkbook.sheets[0],
          filterViews: [{ id: "f1", range, conditions: [] }],
          validationRules: [
            {
              id: "v1",
              type: "dropdown",
              range: { start: { row: 2, column: 1 }, end: { row: 2, column: 1 } },
              allowedValues: ["East", "North", "South"],
            },
          ],
        },
        seededWorkbook.sheets[1],
      ],
    };
    api.setActiveSheet.mockResolvedValue({ ...withState, activeSheetId: "ws-seed-q3-2" });
    api.getWorkbook.mockResolvedValue(withState);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    // Sheet1 is active: its filter and dropdown entry points are visible.
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeInTheDocument();

    // Sheet2 has none of Sheet1's entry points.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.queryByRole("button", { name: "Filter Region" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open dropdown for A2" })).not.toBeInTheDocument();

    // Returning to Sheet1 restores its entry points.
    api.setActiveSheet.mockResolvedValue({ ...withState, activeSheetId: "ws-seed-q3-1" });
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeInTheDocument();
  });

  it("switching to a pivot result worksheet shows its editor and results, and back hides them", async () => {
    const user = userEvent.setup();
    const pivotConfig = {
      sourceSheetId: "ws-seed-q3-1",
      sourceRange: { start: { row: 1, column: 1 }, end: { row: 4, column: 3 } },
      rowField: "Region",
      rowFieldColumn: 1,
      columnField: null,
      columnFieldColumn: null,
      valueField: "Sales",
      valueFieldColumn: 2,
      summarizeBy: "SUM" as const,
      resultRange: { start: { row: 1, column: 1 }, end: { row: 4, column: 2 } },
    };
    const withPivot: typeof seededWorkbook = {
      ...seededWorkbook,
      sheets: [
        seededWorkbook.sheets[0],
        { id: "ws-seed-q3-2", name: "Sheet2", cells: {} },
        {
          id: "ws-pivot-1",
          name: "Pivot1",
          cells: {
            A1: { value: "Region" },
            B1: { value: "SUM of Sales" },
            A2: { value: "East" },
            B2: { value: "1200" },
            A3: { value: "North" },
            B3: { value: "800" },
          },
          pivot: pivotConfig,
        },
      ],
    };
    api.setActiveSheet.mockResolvedValue({ ...withPivot, activeSheetId: "ws-pivot-1" });
    api.getWorkbook.mockResolvedValue(withPivot);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    expect(screen.getByRole("region", { name: "Pivot table editor" })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");

    // The pivot sheet's own state disappears when another tab is active.
    api.setActiveSheet.mockResolvedValue({ ...withPivot, activeSheetId: "ws-seed-q3-1" });
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.queryByRole("region", { name: "Pivot table editor" })).not.toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "A1" })).toHaveTextContent("Region");
    expect(screen.getByRole("gridcell", { name: "B2" })).toHaveTextContent("1200");
  });
});
