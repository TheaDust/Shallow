import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { installApiMock } from "./test/apiMock";

const mock = installApiMock();

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
  mock.reset();
});

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
}

function expectCell(grid: HTMLElement, coord: string, value: string) {
  return waitFor(() =>
    expect(within(grid).getByRole("gridcell", { name: coord })).toHaveTextContent(value),
  );
}

function dragSelect(from: string, to: string) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  fireEvent.mouseDown(within(grid).getByRole("gridcell", { name: from }));
  fireEvent.mouseOver(within(grid).getByRole("gridcell", { name: to }));
  fireEvent.mouseUp(window);
  return grid;
}

describe("REQ-3-1-1 edit a cell through the grid or formula bar", () => {
  it("typing in the formula bar and pressing Enter commits the value to the selected cell", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "East");
    await user.keyboard("{Enter}");
    await expectCell(grid, "D1", "East");
    expect(formulaBar).toHaveValue("East");
  });

  it("pressing Escape cancels an uncommitted formula-bar change", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "North");
    await user.keyboard("{Escape}");
    expect(formulaBar).toHaveValue("");
    await expectCell(grid, "D1", "");

    // the cancelled value is not persisted
    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "D1", "");
  });

  it("clicking another cell commits the pending formula-bar edit", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.type(formulaBar, "East");
    await user.click(within(grid).getByRole("gridcell", { name: "E1" }));

    await expectCell(grid, "D1", "East");
    expect(formulaBar).toHaveValue("");
    expect(within(grid).getByRole("gridcell", { name: "E1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("double-clicking a cell shows an inline text box named 'Edit <coordinate>' and commits with Enter", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    await user.type(editor, "East");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("textbox", { name: "Edit D1" })).not.toBeInTheDocument();
    await expectCell(grid, "D1", "East");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("East");
  });

  it("Escape closes the inline editor without committing", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.dblClick(within(grid).getByRole("gridcell", { name: "D1" }));
    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    await user.type(editor, "North");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Edit D1" })).not.toBeInTheDocument();
    await expectCell(grid, "D1", "");
  });

  it("committed values persist after refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
    for (const [coord, value] of [
      ["D1", "East"],
      ["E1", "1200"],
      ["D2", "North"],
      ["E2", "800"],
    ] as const) {
      await user.click(within(grid).getByRole("gridcell", { name: coord }));
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
      await expectCell(grid, coord, value);
    }

    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "D1", "East");
    await expectCell(reopened, "E1", "1200");
    await expectCell(reopened, "D2", "North");
    await expectCell(reopened, "E2", "800");
    // the seeded source range is untouched
    await expectCell(reopened, "A1", "Item");
    await expectCell(reopened, "B2", "4");
  });

  it("formula cells show the result in the grid, the formula in the formula bar, and update dependencies", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });

    await user.click(within(grid).getByRole("gridcell", { name: "A3" }));
    await user.type(formulaBar, "2");
    await user.keyboard("{Enter}");
    await user.click(within(grid).getByRole("gridcell", { name: "B3" }));
    await user.type(formulaBar, "3");
    await user.keyboard("{Enter}");
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.type(formulaBar, "=A3+B3");
    await user.keyboard("{Enter}");

    await expectCell(grid, "D1", "5");
    expect(formulaBar).toHaveValue("=A3+B3");

    // changing a source value updates the dependent formula result
    await user.click(within(grid).getByRole("gridcell", { name: "A3" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "10");
    await user.keyboard("{Enter}");
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    await expectCell(grid, "D1", "13");
    expect(formulaBar).toHaveValue("=A3+B3");

    // values, formulas and results persist after refresh
    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "A3", "10");
    await expectCell(reopened, "B3", "3");
    await expectCell(reopened, "D1", "13");
    await user.click(within(reopened).getByRole("gridcell", { name: "D1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=A3+B3");
  });

  it("a failed commit shows an error and keeps the last successful value and dependent results", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });

    await user.click(within(grid).getByRole("gridcell", { name: "A3" }));
    await user.type(formulaBar, "2");
    await user.keyboard("{Enter}");
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.type(formulaBar, "=A3*3");
    await user.keyboard("{Enter}");
    await expectCell(grid, "D1", "6");

    mock.failNextCellOp = "Failed to save the cell value";
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    await user.clear(formulaBar);
    await user.type(formulaBar, "99");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to save the cell value");
    await expectCell(grid, "D1", "6"); // last successful result stays
    expect(formulaBar).toHaveValue("=A3*3"); // last successful formula stays
  });
});

describe("REQ-3-1-3 select a rectangular cell range", () => {
  it("dragging from one corner to the opposite corner selects the whole rectangle", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = dragSelect("D1", "E2");

    for (const coord of ["D1", "E1", "D2", "E2"]) {
      expect(within(grid).getByRole("gridcell", { name: coord })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    for (const coord of ["A1", "C1", "D3", "F1"]) {
      expect(within(grid).getByRole("gridcell", { name: coord })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    }
  });

  it("selecting another cell replaces the previous selection", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = dragSelect("A1", "B2");
    expect(within(grid).getByRole("gridcell", { name: "B2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    expect(within(grid).getByRole("gridcell", { name: "D1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(grid).getByRole("gridcell", { name: "B2" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("the complete rectangle persists after refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    dragSelect("D1", "E2");
    await waitFor(() =>
      expect(mock.workbooks()[0].sheets[0].selection).toEqual({ current: "D1", end: "E2" }),
    );

    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    for (const coord of ["D1", "E1", "D2", "E2"]) {
      expect(within(reopened).getByRole("gridcell", { name: coord })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    for (const coord of ["A1", "C1", "D3"]) {
      expect(within(reopened).getByRole("gridcell", { name: coord })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    }
  });

  it("switching worksheets keeps each worksheet's own selection", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    dragSelect("A1", "B2");
    await waitFor(() =>
      expect(mock.workbooks()[0].sheets[0].selection).toEqual({ current: "A1", end: "B2" }),
    );

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    const sheet2Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(sheet2Grid).getByRole("gridcell", { name: "A1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(sheet2Grid).getByRole("gridcell", { name: "B2" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const sheet1Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    for (const coord of ["A1", "A2", "B1", "B2"]) {
      expect(within(sheet1Grid).getByRole("gridcell", { name: coord })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    expect(within(sheet1Grid).getByRole("gridcell", { name: "C1" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // Sheet2 still holds its own selection
    expect(mock.workbooks()[0].sheets[1].selection).toEqual({ current: "A1", end: "A1" });
  });

  it("the grid stays aria-multiselectable with per-cell aria-selected state", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid).toHaveAttribute("aria-multiselectable", "true");
    const cellA1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(cellA1).toHaveAttribute("aria-selected", "true"); // seed selection
    expect(within(grid).getByRole("gridcell", { name: "B1" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});
