import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { installApiMock } from "./test/apiMock";
import { columnLabel, isInRegion } from "./components/WorkbookGrid";

const mock = installApiMock();

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
  mock.reset();
});

describe("grid helpers", () => {
  it("maps column indexes to spreadsheet coordinates", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
  });

  it("detects membership in the selected rectangular region", () => {
    expect(isInRegion("B2", "A1", "C3")).toBe(true);
    expect(isInRegion("A1", "A1", "C3")).toBe(true);
    expect(isInRegion("C3", "A1", "C3")).toBe(true);
    expect(isInRegion("D1", "A1", "C3")).toBe(false);
    expect(isInRegion("A4", "A1", "C3")).toBe(false);
    expect(isInRegion("B2", "B2", "B2")).toBe(true);
    expect(isInRegion("A1", "B2", "B2")).toBe(false);
  });
});

describe("REQ-1-1-1 view and open a workbook", () => {
  it("home page shows the seeded workbook with a link and Last updated text", async () => {
    renderApp();
    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link).toHaveAttribute("href", "#/workbook/wb-q3-sales");
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it("clicking the workbook entry opens the editor with the same workbook state", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));

    expect(window.location.hash).toBe("#/workbook/wb-q3-sales");
    const heading = await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();

    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab).toHaveAttribute("aria-selected", "true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid).toHaveAttribute("aria-multiselectable", "true");

    const cellA1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(cellA1).toHaveAttribute("aria-selected", "true");
    expect(cellA1).toHaveTextContent("Item");

    const cellB1 = within(grid).getByRole("gridcell", { name: "B1" });
    expect(cellB1).toHaveAttribute("aria-selected", "false");

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    expect(formulaBar).toHaveValue("Item");
  });

  it("refreshing (remounting) the exact editor URL restores the same workbook", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    unmount();
    renderApp(); // same hash "#/workbook/wb-q3-sales" persists in jsdom
    const heading = await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(heading).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveTextContent("Item");
  });

  it("selecting another cell updates aria-selected and the formula bar", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    const cellB1 = within(grid).getByRole("gridcell", { name: "B1" });
    await user.click(cellB1);
    expect(cellB1).toHaveAttribute("aria-selected", "true");
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Qty");
  });

  it("data from another workbook does not appear in the opened grid", async () => {
    const user = userEvent.setup();
    mock.addWorkbook({
      id: "wb-other",
      name: "Other Book",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activeSheetId: "s-other",
      sheets: [{ id: "s-other", name: "Sheet1", activeCell: "A1", cells: { H5: "Secret" } }],
    });
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveTextContent("Item");
    expect(within(grid).queryByText("Secret")).not.toBeInTheDocument();
  });
});

describe("REQ-1-2-1 create a blank workbook", () => {
  it("New blank workbook opens the creation page whose submit button is Create", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    expect(window.location.hash).toBe("#/new");
    expect(await screen.findByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("creating a workbook opens the editor with a blank Sheet1 and A1 selected", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await user.type(await screen.findByLabelText("Workbook name"), "My Book");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "My Book" });
    expect(heading).toBeInTheDocument();
    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const cellA1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(cellA1).toHaveAttribute("aria-selected", "true");
    expect(cellA1).toHaveTextContent("");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("");
  });

  it("the created workbook appears on the home page and survives refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await user.click(await screen.findByRole("button", { name: "Create" }));
    await screen.findByRole("heading", { level: 1, name: "Untitled workbook" });

    window.location.hash = "#/";
    const link = await screen.findByRole("link", { name: "Untitled workbook" });
    expect(link).toBeInTheDocument();

    unmount();
    renderApp();
    expect(await screen.findByRole("link", { name: "Untitled workbook" })).toBeInTheDocument();
  });
});

describe("REQ-1-2-2 rename a workbook", () => {
  it("Rename workbook opens a dialog with the prefilled name and a Save button", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const input = within(dialog).getByLabelText("Workbook name");
    expect(input).toHaveValue("Q3 Sales");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saving a new name updates the editor title and the home page link", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const input = within(dialog).getByLabelText("Workbook name");
    await user.clear(input);
    await user.type(input, "  FY26 Sales  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { level: 1, name: "FY26 Sales" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    window.location.hash = "#/";
    const link = await screen.findByRole("link", { name: "FY26 Sales" });
    expect(link).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Q3 Sales" })).not.toBeInTheDocument();
  });

  it("reopening the workbook after rename shows the most recently saved name", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    await user.clear(within(dialog).getByLabelText("Workbook name"));
    await user.type(within(dialog).getByLabelText("Workbook name"), "FY26 Sales");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "FY26 Sales" });

    unmount();
    renderApp(); // same editor hash; mock store still holds the renamed workbook
    expect(await screen.findByRole("heading", { level: 1, name: "FY26 Sales" })).toBeInTheDocument();
  });

  it("an empty name is rejected and the original name stays displayed", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const input = within(dialog).getByLabelText("Workbook name");
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Workbook name cannot be empty");
    expect(screen.getByRole("dialog", { name: "Rename workbook" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Q3 Sales" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Workbook name" })).toHaveValue("   ");
  });
});
