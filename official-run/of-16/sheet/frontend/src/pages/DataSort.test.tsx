import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBackend, type FakeBackend } from "../test/fake-backend";
import { WorkbookEditorPage } from "./WorkbookEditorPage";

/** Drags from one corner to the diagonally opposite cell of a rectangle. */
function selectRange(from: string, to: string): void {
  fireEvent.pointerDown(screen.getByRole("gridcell", { name: from }), { button: 0, buttons: 1 });
  fireEvent.pointerEnter(screen.getByRole("gridcell", { name: to }), { buttons: 1 });
  fireEvent.pointerUp(window);
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("sort range", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend();
    vi.stubGlobal("fetch", backend.fetch);
    window.location.hash = "#/workbooks/q3-sales";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function runDataCommand(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
    await user.click(screen.getByRole("button", { name: "Data" }));
    const menu = await screen.findByRole("menu", { name: "Data" });
    await user.click(within(menu).getByRole("menuitem", { name }));
  }

  async function openSortDialog(user: ReturnType<typeof userEvent.setup>) {
    await runDataCommand(user, "Sort range");
    return screen.findByRole("dialog", { name: "Sort range" });
  }

  function rowValues(letters: string[]): (string | null)[] {
    return [2, 3, 4].map((row) => {
      const cell = screen.queryByRole("gridcell", { name: `${letters[0]}${row}` });
      return cell ? cell.textContent : null;
    });
  }

  it("sorts the selected range by a chosen column and keeps it after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A1", "C4");
    const dialog = await openSortDialog(user);

    // The combo boxes use the required names and option roles.
    const sortBy = within(dialog).getByRole("combobox", { name: "Sort by" });
    expect(within(sortBy).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);
    const order = within(dialog).getByRole("combobox", { name: "Order" });
    expect(within(order).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ascending",
      "Descending",
    ]);
    // The seeded first row is a text-only header, so it stays out of the sort.
    expect((within(dialog).getByRole("checkbox", { name: "Data has header row" }) as HTMLInputElement).checked).toBe(true);

    await user.selectOptions(sortBy, within(sortBy).getByRole("option", { name: "Sales" }));
    await user.selectOptions(order, "ascending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sort range" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("South"));
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("700");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("800");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("1200");
    // The header row did not participate in the sort.
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("South");
    expect(backend.workbooks[0].worksheets[0].cells.C4).toBe("Open");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("South"));
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("East");
  });

  it("sorts descending and leaves data outside the selected range unchanged", async () => {
    backend.workbooks[0].worksheets[0].cells.A5 = "Total";
    backend.workbooks[0].worksheets[0].cells.B5 = "2700";
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Order" }),
      "descending",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Sort by" }),
      within(dialog).getByRole("option", { name: "Sales" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East"));
    expect(rowValues(["B"])).toEqual(["1200", "800", "700"]);
    // Row 5 is outside the sorted rectangle and keeps its value.
    expect(screen.getByRole("gridcell", { name: "A5" }).textContent).toBe("Total");
    expect(screen.getByRole("gridcell", { name: "B5" }).textContent).toBe("2700");
  });

  it("keeps the filter hiding rows of the same range after sorting it", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A1", "C4");
    await runDataCommand(user, "Create filter");
    await screen.findByRole("button", { name: "Filter Status" });
    await user.click(screen.getByRole("button", { name: "Filter Status" }));
    const filterDialog = await screen.findByRole("dialog", { name: "Filter Status" });
    await user.click(within(filterDialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(filterDialog).getByRole("checkbox", { name: "Open" }));
    await user.click(within(filterDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());

    selectRange("A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Sort by" }),
      within(dialog).getByRole("option", { name: "Sales" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    // Ascending order is South/North/East; the Closed record (North) stays hidden.
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("South"));
    expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("East");
    expect(backend.workbooks[0].worksheets[0].cells.A3).toBe("North");
    expect(backend.workbooks[0].worksheets[0].filter).toEqual({
      range: "A1:C4",
      rules: [{ header: "Status", type: "values", values: ["Open"] }],
    });
  });

  it("re-derives a formula at its new position and shows its original text", async () => {
    backend.workbooks[0].worksheets[0].cells.D1 = "=B2";
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("1200");

    selectRange("A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Sort by" }),
      within(dialog).getByRole("option", { name: "Sales" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    // B2 now holds 700, so the dependent formula result follows the new position.
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("700"));
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=B2");
  });

  it("reports a failed sort and keeps the grid order", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A1", "C4");
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Sort by" }),
      within(dialog).getByRole("option", { name: "Sales" }),
    );

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/sort")) return errorResponse(400, { error: "Could not sort the range" });
      return backend.fetch(input as RequestInfo, init);
    });

    await user.click(within(dialog).getByRole("button", { name: "Sort" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Could not sort the range");
    // The grid kept its original order and the stored records are unchanged.
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("South");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("East");
  });
});
