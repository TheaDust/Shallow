import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { stubFetch, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

const SHEET1 = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet1";

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function openHeaderMenu(element: HTMLElement) {
  fireEvent.contextMenu(element, { clientX: 40, clientY: 60 });
}

describe("row and column structure menus", () => {
  it("names row headers with the decimal row number and column headers with the column letter", async () => {
    stubFetch((request) =>
      request.method === "GET" ? { body: { workbook: workbookFixture() } } : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const sheet = grid();
    expect(within(sheet).getAllByRole("rowheader")).toHaveLength(40);
    expect(within(sheet).getByRole("rowheader", { name: "1" })).toBeTruthy();
    expect(within(sheet).getByRole("rowheader", { name: "40" })).toBeTruthy();
    expect(within(sheet).getAllByRole("columnheader")).toHaveLength(20);
    expect(within(sheet).getByRole("columnheader", { name: "A" })).toBeTruthy();
    expect(within(sheet).getByRole("columnheader", { name: "T" })).toBeTruthy();
  });

  it("opens the row menu on right click and inserts a row through the server", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const shifted = workbookFixture({
      worksheets: [
        {
          ...seed.worksheets[0],
          cells: { A1: "Region", A2: "East", B2: "1200", A4: "North", B4: "800" },
          values: { A1: "Region", A2: "East", B2: "1200", A4: "North", B4: "800" },
        },
        seed.worksheets[1],
      ],
    });
    const { calls } = stubFetch((request) => {
      if (request.method === "GET") return { body: { workbook: seed } };
      if (request.method === "POST" && request.path === `${SHEET1}/rows`) {
        return { body: { workbook: shifted } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    openHeaderMenu(within(grid()).getByRole("rowheader", { name: "2" }));
    const menu = screen.getByRole("menu", { name: "Row 2 menu" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row below" }));

    await waitFor(() =>
      expect(calls.some((call) => call.body?.op === "insert-row-below" && call.body?.row === 2)).toBe(true),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(within(grid()).getByRole("gridcell", { name: "A4" }).textContent).toBe("North");
    expect(within(grid()).getByRole("gridcell", { name: "A3" }).textContent).toBe("");
  });

  it("opens the column menu on right click and deletes a column through the server", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const deleted = workbookFixture({
      worksheets: [
        {
          ...seed.worksheets[0],
          cells: { A1: "Region", A2: "East", A3: "North" },
          values: { A1: "Region", A2: "East", A3: "North" },
        },
        seed.worksheets[1],
      ],
    });
    const { calls } = stubFetch((request) => {
      if (request.method === "GET") return { body: { workbook: seed } };
      if (request.method === "POST" && request.path === `${SHEET1}/columns`) {
        return { body: { workbook: deleted } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    openHeaderMenu(within(grid()).getByRole("columnheader", { name: "B" }));
    const menu = screen.getByRole("menu", { name: "Column B menu" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));

    await waitFor(() =>
      expect(calls.some((call) => call.body?.op === "delete-column" && call.body?.column === 2)).toBe(true),
    );
    expect(within(grid()).getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(within(grid()).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  });

  it("keeps the previous structure and reports the error when the server rejects the operation", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    stubFetch((request) => {
      if (request.method === "GET") return { body: { workbook: seed } };
      if (request.method === "POST" && request.path === `${SHEET1}/rows`) {
        return { status: 400, body: { error: "Invalid row number" } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    openHeaderMenu(within(grid()).getByRole("rowheader", { name: "1" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete row" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid row number");
    expect(within(grid()).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(grid()).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });

  it("closes the header menu with Escape without touching the grid", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) =>
      request.method === "GET" ? { body: { workbook: workbookFixture() } } : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    const header = within(grid()).getByRole("rowheader", { name: "3" });
    openHeaderMenu(header);
    expect(screen.getByRole("menu", { name: "Row 3 menu" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("navigates the open menu with the arrow keys without moving the grid selection", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) =>
      request.method === "GET" ? { body: { workbook: workbookFixture() } } : undefined,
    );
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    openHeaderMenu(within(grid()).getByRole("rowheader", { name: "2" }));
    const items = within(screen.getByRole("menu", { name: "Row 2 menu" })).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);

    expect(within(grid()).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
  });
});
