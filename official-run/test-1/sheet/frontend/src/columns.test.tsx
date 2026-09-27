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

async function openColumnMenu(column: string) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  const header = within(grid).getByRole("columnheader", { name: column });
  fireEvent.contextMenu(header);
  return { grid, header };
}

function expectCell(grid: HTMLElement, coord: string, value: string) {
  return waitFor(() =>
    expect(within(grid).getByRole("gridcell", { name: coord })).toHaveTextContent(value),
  );
}

describe("REQ-2-2-2 insert and delete columns", () => {
  it("column headers use the columnheader role with the column letter as the accessible name", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    for (const name of ["A", "B", "C", "T"]) {
      expect(within(grid).getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });

  it("right-clicking a column header opens a menu with the three column commands as menuitems", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openColumnMenu("B");
    const menu = within(grid).getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Insert 1 column left" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Insert 1 column right" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete column" })).toBeInTheDocument();
    // Escape closes the menu again
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Insert 1 column left inserts a blank column and shifts data right", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openColumnMenu("B");
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 column left" }));

    // column A stays put; B becomes the blank column; old B data moves to C
    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B1", "");
    await expectCell(grid, "B2", "");
    await expectCell(grid, "C1", "Qty");
    await expectCell(grid, "C2", "4");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Insert 1 column right inserts a blank column to the right of the target column", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openColumnMenu("B");
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 column right" }));

    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B1", "Qty");
    await expectCell(grid, "B2", "4");
    await expectCell(grid, "C1", "");
    await expectCell(grid, "C2", "");
  });

  it("Delete column removes the target column and keeps the rest", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openColumnMenu("B");
    await user.click(within(grid).getByRole("menuitem", { name: "Delete column" }));

    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "A2", "Pen");
    await waitFor(() => expect(within(grid).queryByText("Qty")).not.toBeInTheDocument());
    await expectCell(grid, "B2", "");
    await expectCell(grid, "B1", "");
  });

  it("the column structure persists after refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const { grid } = await openColumnMenu("B");
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 column left" }));
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "C2", "4");

    unmount();
    renderApp(); // same editor hash; the mock store keeps the shifted sheet
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "A1", "Item");
    await expectCell(reopened, "A2", "Pen");
    await expectCell(reopened, "C1", "Qty");
    await expectCell(reopened, "C2", "4");
  });

  it("a failed column operation shows an error and the grid keeps the pre-operation structure", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    mock.failNextColOp = "Column operation failed";

    const { grid } = await openColumnMenu("B");
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 column left" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Column operation failed");
    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B2", "4");

    // after refresh the original structure remains
    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "A2", "Pen");
    await expectCell(reopened, "B2", "4");
  });

  it("column operations apply only to the active worksheet and leave other worksheets unchanged", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openColumnMenu("B");
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 column left" }));
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "C2", "4");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    const sheet2Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await expectCell(sheet2Grid, "A1", "");
    expect(within(sheet2Grid).queryByText("Pen")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const sheet1Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await expectCell(sheet1Grid, "A2", "Pen");
    await expectCell(sheet1Grid, "C2", "4");
  });
});
