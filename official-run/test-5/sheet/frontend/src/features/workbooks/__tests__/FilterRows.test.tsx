import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { workbookFixture } from "./helpers";
import { stubSheetServer } from "./sheetServer";

const EDITOR = "/api/workbooks/wb-q3-sales";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).queryByRole("gridcell", { name: address });
}

function filterRequests(server: ReturnType<typeof stubSheetServer>) {
  return server.calls.filter((call) => call.method === "PATCH" && "filter" in (call.body ?? {}));
}

async function openEditor(server: ReturnType<typeof stubSheetServer>) {
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
  return server;
}

async function openFilter(server: ReturnType<typeof stubSheetServer>, header: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Filter ${header}` }));
  return screen.findByRole("dialog", { name: `Filter ${header}` });
}

describe("filtering the rows of a data region", () => {
  it("offers a Data menu whose commands hide the rows a value filter excludes", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    // The toolbar button is named "Data" and opens a menu of menuitem commands.
    const dataButton = screen.getByRole("button", { name: "Data" });
    expect(dataButton.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(dataButton);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Create filter" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Clear filter" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Data validation" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Create filter" }));

    // The filter covers the data region around the current cell (A1:C4).
    await waitFor(() => expect(filterRequests(server)).toHaveLength(1));
    expect(filterRequests(server)[0].body).toEqual({
      filter: { range: { start: "A1", end: "C4" }, columns: {} },
    });

    // Every header of the region provides its own "Filter <header text>" button.
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();

    const dialog = await openFilter(server, "Status");
    // Checkboxes carry the distinct source values of that column as their name.
    const open = within(dialog).getByRole("checkbox", { name: "Open" });
    within(dialog).getByRole("checkbox", { name: "Closed" });
    within(dialog).getByRole("button", { name: "Clear selection" });
    await user.click(open);

    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const applied = filterRequests(server).at(-1)!;
    expect(applied.body).toEqual({
      filter: {
        range: { start: "A1", end: "C4" },
        columns: { C: { kind: "values", values: ["Closed"] } },
      },
    });

    // Only visibility changes: the hidden records keep their position and value.
    await waitFor(() => expect(cell("A2")).toBeNull());
    expect(cell("A3")?.textContent).toBe("North");
    expect(cell("A4")).toBeNull();
    expect(cell("A1")?.textContent?.trim()).toBe("Region");
    expect(server.sheet().cells.A2).toBe("East");
    expect(server.sheet().cells.A4).toBe("South");
  });

  it("combines conditions of different columns with AND and clears them again", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(filterRequests(server)).toHaveLength(1));

    // A condition filter: Sales greater than 1000 keeps only the East record.
    const salesDialog = await openFilter(server, "Sales");
    await user.selectOptions(within(salesDialog).getByRole("combobox", { name: "Condition" }), "Greater than");
    await user.type(within(salesDialog).getByLabelText("Value"), "1000");
    await user.click(within(salesDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cell("A3")).toBeNull());
    expect(cell("A2")?.textContent).toBe("East");

    // A second column is combined with the first one (AND).
    const statusDialog = await openFilter(server, "Status");
    await user.click(within(statusDialog).getByRole("checkbox", { name: "Open" }));
    await user.click(within(statusDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cell("A2")).toBeNull());

    // "Clear filter" brings every source record back, in its original order.
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear filter" }));
    await waitFor(() => expect(cell("A2")?.textContent).toBe("East"));
    expect(cell("A3")?.textContent).toBe("North");
    expect(cell("A4")?.textContent).toBe("South");
    expect(server.sheet().cells.A2).toBe("East");
    expect(filterRequests(server).at(-1)!.body).toEqual({ filter: null });
  });

  it("keeps the same rows hidden after the workbook is reopened", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(filterRequests(server)).toHaveLength(1));

    const dialog = await openFilter(server, "Region");
    await user.click(within(dialog).getByRole("checkbox", { name: "East" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cell("A2")).toBeNull());

    // Reopening the workbook shows the same records as before the refresh.
    cleanup();
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    await waitFor(() => expect(cell("A2")).toBeNull());
    expect(cell("A3")?.textContent).toBe("North");
    expect(cell("A4")?.textContent).toBe("South");
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
  });

  it("keeps another worksheet's rows untouched while one is filtered", async () => {
    const user = userEvent.setup();
    const server = await openEditor(stubSheetServer(workbookFixture()));

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(filterRequests(server)).toHaveLength(1));

    const dialog = await openFilter(server, "Region");
    await user.click(within(dialog).getByRole("checkbox", { name: "East" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(cell("A2")).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cell("A2")).toBeNull());
  });
});
