import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";

let backend: ReturnType<typeof createMockBackend>;

beforeEach(() => {
  backend = createMockBackend([seedWorkbook()]);
  vi.stubGlobal("fetch", backend.fetchImpl);
  window.location.hash = "#/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

async function openEditor() {
  window.location.hash = "#/workbooks/workbook-q3-sales";
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { user, view };
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function gridCell(name: string): HTMLElement {
  return within(grid()).getByRole("gridcell", { name });
}

function queryCell(name: string): HTMLElement | null {
  return within(grid()).queryByRole("gridcell", { name });
}

function worksheet(index = 0) {
  return backend.workbooks[0].worksheets[index];
}

async function dragRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.pointer([
    { keys: "[MouseLeft>]", target: gridCell(from) },
    { target: gridCell(to) },
    { keys: "[/MouseLeft]" },
  ]);
}

/** Opens the "Sort range" dialog through the Data menu. */
async function openSortDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Sort range" }));
  return screen.findByRole("dialog", { name: "Sort range" });
}

/** Chooses one option of a named combo box. */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboLabel: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: comboLabel }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/** The column values of the three seeded records, in the order they render. */
function columnValues(column: string): string[] {
  return ["2", "3", "4"].map((row) => gridCell(`${column}${row}`).textContent ?? "");
}

describe("sorting a selected range", () => {
  it("offers 'Sort range' in the Data menu with the named controls", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);

    expect(within(dialog).getByRole("combobox", { name: "Sort by" })).not.toBeNull();
    expect(within(dialog).getByRole("combobox", { name: "Order" })).not.toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Data has header row" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Sort" })).not.toBeNull();

    // "Sort by" lists the header text of the selected range as its options.
    await user.click(within(dialog).getByRole("combobox", { name: "Sort by" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);
    await user.keyboard("{Escape}");

    await user.click(within(dialog).getByRole("combobox", { name: "Order" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual(["Ascending", "Descending"]),
    );
  });

  it("sorts the selected range ascending and keeps the order after a refresh", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await chooseOption(user, "Order", "Ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The header row stays on top; the records follow by ascending sales.
    expect(columnValues("A")).toEqual(["South", "North", "East"]);
    expect(columnValues("B")).toEqual(["700", "800", "1200"]);
    expect(columnValues("C")).toEqual(["Open", "Closed", "Open"]);
    expect(gridCell("A1").textContent).toBe("Region");
    expect(worksheet().cells.B4).toBe("1200");

    view.unmount();
    const reopened = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(columnValues("A")).toEqual(["South", "North", "East"]);
    expect(columnValues("B")).toEqual(["700", "800", "1200"]);
    reopened.unmount();
  });

  it("sorts descending and compares the values of the sort column by their type", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await chooseOption(user, "Order", "Descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Numerically 1200 > 800 > 700; as text 700 would have been the largest.
    expect(columnValues("B")).toEqual(["1200", "800", "700"]);
    expect(columnValues("A")).toEqual(["East", "North", "South"]);
  });

  it("keeps records with equal sort keys in their original order", async () => {
    worksheet().cells = {
      A1: "Region",
      B1: "Sales",
      A2: "South",
      B2: "700",
      A3: "North",
      B3: "800",
      A4: "East",
      B4: "700",
      A5: "West",
      B5: "700",
    };
    const { user } = await openEditor();
    await dragRange(user, "A1", "B5");
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await chooseOption(user, "Order", "Ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(["A2", "A3", "A4", "A5"].map((name) => gridCell(name).textContent)).toEqual([
      "South",
      "East",
      "West",
      "North",
    ]);
  });

  it("reorders only the selected rectangle and leaves the other columns alone", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "B4");
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await chooseOption(user, "Order", "Ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(columnValues("A")).toEqual(["South", "North", "East"]);
    // Column C sits outside the selection: it keeps its values in place.
    expect(columnValues("C")).toEqual(["Open", "Closed", "Open"]);
    expect(worksheet().cells.C3).toBe("Closed");
    expect(worksheet(1).cells).toEqual({});
  });

  it("sorts the first row too when it is not declared a header", async () => {
    worksheet().cells = {
      A1: "South",
      B1: "700",
      A2: "North",
      B2: "800",
      A3: "East",
      B3: "1200",
    };
    const { user } = await openEditor();
    await dragRange(user, "A1", "B3");
    const dialog = await openSortDialog(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "Data has header row" }));
    await chooseOption(user, "Sort by", "700");
    await chooseOption(user, "Order", "Descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(["A1", "A2", "A3"].map((name) => gridCell(name).textContent)).toEqual(["East", "North", "South"]);
    expect(["B1", "B2", "B3"].map((name) => gridCell(name).textContent)).toEqual(["1200", "800", "700"]);
  });

  it("shows the remapped formula and its result for the new position", async () => {
    worksheet().cells = {
      A1: "Region",
      B1: "Sales",
      C1: "Computed",
      A2: "East",
      B2: "1200",
      C2: "=B2*2",
      A3: "North",
      B3: "800",
      C3: "=B3*2",
      A4: "South",
      B4: "700",
      C4: "=B4*2",
    };
    const { user } = await openEditor();
    await dragRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await chooseOption(user, "Order", "Ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // East moved to row 4: its formula follows the record and the grid shows
    // the result computed from the sales value that sits there now.
    await user.click(gridCell("C4"));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("=B4*2"),
    );
    expect(gridCell("C4").textContent).toBe("2400");
    expect(gridCell("A4").textContent).toBe("East");
  });

  it("keeps a filter view and the rows it hides across a sort", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "A1", "C4");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const filterDialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(filterDialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(filterDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(queryCell("A3")).toBeNull());

    // The same rectangle is still selected, so "Sort range" acts on it.
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await chooseOption(user, "Order", "Ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // North keeps its record (now on the last row) and stays hidden.
    expect(gridCell("A2").textContent).toBe("South");
    expect(queryCell("A3")).toBeNull();
    expect(gridCell("A4").textContent).toBe("East");
    expect(worksheet().cells.A3).toBe("North");
    expect(worksheet().filter?.range).toEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 });

    view.unmount();
    const reopened = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(within(grid()).queryByRole("gridcell", { name: "A3" })).toBeNull();
    expect(within(grid()).getByRole("gridcell", { name: "A2" }).textContent).toBe("South");
    reopened.unmount();
  });

  it("shows the failure and keeps the original order when the sort is rejected", async () => {
    const { user } = await openEditor();
    const failing = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/sort")) {
        return new Response(JSON.stringify({ error: "Invalid sort range" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      return backend.fetchImpl(input, init);
    };
    vi.stubGlobal("fetch", failing);

    await dragRange(user, "A1", "C4");
    const dialog = await openSortDialog(user);
    await chooseOption(user, "Sort by", "Sales");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Invalid sort range");
    expect(screen.getByRole("dialog", { name: "Sort range" })).not.toBeNull();
    expect(queryCell("A2")).not.toBeNull();
    expect(columnValues("A")).toEqual(["East", "North", "South"]);
    expect(worksheet().cells.A2).toBe("East");
  });
});
