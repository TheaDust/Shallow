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
  setValidation: vi.fn(),
  sortRange: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, ...api };
});

function withValidationRules(workbook: Workbook, validationRules: unknown[]) {
  return {
    ...workbook,
    sheets: [{ ...workbook.sheets[0], validationRules }, ...workbook.sheets.slice(1)],
  };
}

function withSelection(workbook: Workbook, selection: { start: { row: number; column: number }; end: { row: number; column: number } }) {
  return {
    ...workbook,
    sheets: [{ ...workbook.sheets[0], selection }, ...workbook.sheets.slice(1)],
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
  api.updateCells.mockResolvedValue(seededWorkbook as never);
  api.setValidation.mockResolvedValue(seededWorkbook as never);
  api.sortRange.mockResolvedValue(seededWorkbook as never);
});

describe("Data menu entries", () => {
  it("offers Sort range and Data validation as menuitems under the Data button", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    expect(screen.getByRole("menuitem", { name: "Sort range" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Data validation" })).toBeInTheDocument();
  });
});

describe("Data validation dialog", () => {
  it("opens with Rule type options and Allowed values, and Save applies a trimmed dropdown rule", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });

    const ruleType = within(dialog).getByLabelText("Rule type");
    expect(within(ruleType).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Dropdown",
      "Number range",
    ]);
    expect(within(dialog).getByLabelText("Allowed values")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Allowed values"), " East, North ,South ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.setValidation).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
        rule: { type: "dropdown", allowedValues: ["East", "North", "South"] },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).not.toBeInTheDocument());
  });

  it("switches to Number range and shows Minimum and Maximum", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });

    await user.selectOptions(within(dialog).getByLabelText("Rule type"), "number");
    expect(within(dialog).queryByLabelText("Allowed values")).not.toBeInTheDocument();
    const minimum = within(dialog).getByLabelText("Minimum");
    const maximum = within(dialog).getByLabelText("Maximum");

    await user.type(minimum, "0");
    await user.type(maximum, "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.setValidation).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        range: { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } },
        rule: { type: "number", min: 0, max: 100 },
      }),
    );
  });

  it("prefills an existing rule and Delete rule removes it", async () => {
    const user = userEvent.setup();
    const workbook = withValidationRules(seededWorkbook, [
      {
        id: "r1",
        type: "dropdown",
        allowedValues: ["East", "North"],
        range: { start: { row: 1, column: 1 }, end: { row: 2, column: 1 } },
      },
    ]);
    api.getWorkbook.mockResolvedValue(workbook as never);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });

    expect(within(dialog).getByLabelText("Rule type")).toHaveValue("dropdown");
    expect(within(dialog).getByLabelText("Allowed values")).toHaveValue("East, North");
    await user.click(within(dialog).getByRole("button", { name: "Delete rule" }));

    await waitFor(() => expect(api.setValidation).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", { deleteRuleId: "r1" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data validation" })).not.toBeInTheDocument());
  });
});

describe("dropdown cells in the grid", () => {
  it("renders an Open dropdown button whose options use the option role and trimmed values", async () => {
    const user = userEvent.setup();
    const workbook = withValidationRules(seededWorkbook, [
      {
        id: "r1",
        type: "dropdown",
        allowedValues: ["East", "North"],
        range: { start: { row: 2, column: 1 }, end: { row: 4, column: 1 } },
      },
    ]);
    api.getWorkbook.mockResolvedValue(workbook as never);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    const button = screen.getByRole("button", { name: "Open dropdown for A2" });
    expect(button).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open dropdown for B2" })).not.toBeInTheDocument();

    await user.click(button);
    const listbox = screen.getByRole("listbox", { name: "Options for A2" });
    expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual(["East", "North"]);

    await user.click(within(listbox).getByRole("option", { name: "North" }));
    await waitFor(() => expect(api.updateCells).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", { A2: "North" }));
  });
});

describe("Sort range dialog", () => {
  it("lists range headers in Sort by, offers Ascending/Descending and sorts the range", async () => {
    const user = userEvent.setup();
    const workbook = withSelection(seededWorkbook, {
      start: { row: 1, column: 1 },
      end: { row: 6, column: 3 },
    });
    api.getWorkbook.mockResolvedValue(workbook as never);
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sort range" }));
    const dialog = await screen.findByRole("dialog", { name: "Sort range" });

    const sortBy = within(dialog).getByLabelText("Sort by");
    expect(within(sortBy).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);

    const order = within(dialog).getByLabelText("Order");
    expect(within(order).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ascending",
      "Descending",
    ]);

    const headerRow = within(dialog).getByRole("checkbox", { name: "Data has header row" });
    expect(headerRow).toBeChecked();

    await user.selectOptions(sortBy, "2");
    await user.selectOptions(order, "descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() =>
      expect(api.sortRange).toHaveBeenCalledWith("wb-seed-q3", "ws-seed-q3-1", {
        range: { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } },
        sortBy: 2,
        order: "descending",
        hasHeaderRow: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sort range" })).not.toBeInTheDocument());
  });

  it("can uncheck Data has header row before sorting", async () => {
    const user = userEvent.setup();
    render(<EditorPage workbookId="wb-seed-q3" />);
    await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sort range" }));
    const dialog = await screen.findByRole("dialog", { name: "Sort range" });

    await user.click(within(dialog).getByRole("checkbox", { name: "Data has header row" }));
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() =>
      expect(api.sortRange).toHaveBeenCalledWith(
        "wb-seed-q3",
        "ws-seed-q3-1",
        expect.objectContaining({ hasHeaderRow: false }),
      ),
    );
  });
});
