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

async function openRowMenu(row: number) {
  const grid = screen.getByRole("grid", { name: "Worksheet grid" });
  const header = within(grid).getByRole("rowheader", { name: String(row) });
  fireEvent.contextMenu(header);
  return { grid, header };
}

function expectCell(grid: HTMLElement, coord: string, value: string) {
  return waitFor(() =>
    expect(within(grid).getByRole("gridcell", { name: coord })).toHaveTextContent(value),
  );
}

describe("REQ-2-2-1 insert and delete rows", () => {
  it("row numbers use the rowheader role with the decimal row number as the accessible name", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    for (const name of ["1", "2", "3", "10"]) {
      expect(within(grid).getByRole("rowheader", { name })).toBeInTheDocument();
    }
  });

  it("right-clicking a row number opens a menu with the three row commands as menuitems", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openRowMenu(2);
    const menu = within(grid).getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Insert 1 row above" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Insert 1 row below" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete row" })).toBeInTheDocument();
    // Escape closes the menu again
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Insert 1 row above inserts a blank row and shifts Pen/4 down", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openRowMenu(2);
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 row above" }));

    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B1", "Qty");
    await expectCell(grid, "A2", "");
    await expectCell(grid, "A3", "Pen");
    await expectCell(grid, "B3", "4");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Insert 1 row below inserts a blank row below the target row", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openRowMenu(2);
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 row below" }));

    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B1", "Qty");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B2", "4");
    await expectCell(grid, "A3", "");
  });

  it("Delete row removes the target row and shifts later rows up", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openRowMenu(2);
    await user.click(within(grid).getByRole("menuitem", { name: "Delete row" }));

    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B1", "Qty");
    await waitFor(() => expect(within(grid).queryByText("Pen")).not.toBeInTheDocument());
  });

  it("the row structure persists after refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const { grid } = await openRowMenu(3);
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 row above" }));

    unmount();
    renderApp(); // same editor hash; the mock store keeps the shifted sheet
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "A1", "Item");
    await expectCell(reopened, "B1", "Qty");
    await expectCell(reopened, "A2", "Pen");
    await expectCell(reopened, "B2", "4");
    await expectCell(reopened, "A3", "");
  });

  it("a failed row operation shows an error and the grid keeps the pre-operation structure", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    mock.failNextRowOp = "Row operation failed";

    const { grid } = await openRowMenu(2);
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 row above" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Row operation failed");
    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B1", "Qty");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B2", "4");

    // after refresh the original structure remains
    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "A1", "Item");
    await expectCell(reopened, "A2", "Pen");
    await expectCell(reopened, "B2", "4");
  });

  it("row operations apply only to the active worksheet and leave other worksheets unchanged", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const { grid } = await openRowMenu(2);
    await user.click(within(grid).getByRole("menuitem", { name: "Insert 1 row above" }));
    await expectCell(grid, "A3", "Pen");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    const sheet2Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await expectCell(sheet2Grid, "A1", "");
    expect(within(sheet2Grid).queryByText("Pen")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    const sheet1Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await expectCell(sheet1Grid, "A3", "Pen");
    await expectCell(sheet1Grid, "B3", "4");
  });
});
