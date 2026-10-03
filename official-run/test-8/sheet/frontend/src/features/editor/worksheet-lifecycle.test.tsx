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
  window.location.hash = "";
});

async function openEditor() {
  window.location.hash = "#/workbooks/workbook-q3-sales";
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { user, view };
}

function workbook(): (typeof backend.workbooks)[number] {
  return backend.workbooks[0];
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function gridCell(name: string): HTMLElement {
  return within(grid()).getByRole("gridcell", { name });
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

async function dragRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.pointer([
    { keys: "[MouseLeft>]", target: gridCell(from) },
    { target: gridCell(to) },
    { keys: "[/MouseLeft]" },
  ]);
}

async function clickDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

describe("worksheet renaming", () => {
  it("renames the worksheet from the tab menu and persists the trimmed name", async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    const rename = await screen.findByRole("menuitem", { name: "Rename" });
    await user.click(rename);

    const input = (await screen.findByRole("textbox", { name: "Worksheet name" })) as HTMLInputElement;
    expect(input.value).toBe("Sheet1");

    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Worksheet name cannot be empty")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet1" })).not.toBeNull();

    await user.type(input, "Sheet2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Worksheet name already exists")).not.toBeNull();
    expect(workbook().worksheets[0].name).toBe("Sheet1");

    await user.clear(input);
    await user.type(input, "  Quarterly Data  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Quarterly Data" })).not.toBeNull());
    expect(screen.getByRole("tab", { name: "Sheet2" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Worksheet options for Quarterly Data" })).not.toBeNull();
    expect(workbook().worksheets[0].name).toBe("Quarterly Data");
    expect(workbook().worksheets[0].cells.A2).toBe("East");
  });

  it("keeps the renamed worksheet after reopening the workbook entry", async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = (await screen.findByRole("textbox", { name: "Worksheet name" })) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Detail");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Detail" })).not.toBeNull());

    view.unmount();
    render(<App />);

    expect(await screen.findByRole("tab", { name: "Detail" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Sheet1" })).not.toBeNull();
  });
});

describe("switching worksheets", () => {
  it("switches the grid, formula bar, selection and filter buttons to the clicked worksheet", async () => {
    const { user } = await openEditor();

    // A filter on Sheet1 gives it a filter button per header of its region.
    await dragRange(user, "A1", "C4");
    await clickDataCommand(user, "Create filter");
    await screen.findByRole("button", { name: "Filter Region" });
    await user.click(gridCell("A1"));
    await waitFor(() => expect(formulaBar().value).toBe("Region"));

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await screen.findByRole("tab", { name: "Sheet2", selected: true });
    // Sheet2 is blank: no filter buttons, empty grid, A1 selected, empty bar.
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(gridCell("A2").textContent).toBe("");
    expect(gridCell("A1").getAttribute("aria-selected")).toBe("true");
    expect(formulaBar().value).toBe("");

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("tab", { name: "Sheet1", selected: true });
    expect(screen.getByRole("button", { name: "Filter Region" })).not.toBeNull();
    expect(gridCell("B2").textContent).toBe("1200");
    expect(formulaBar().value).toBe("Region");
    // Switching never modified the source worksheet.
    expect(workbook().worksheets[0].cells.A2).toBe("East");
    expect(workbook().worksheets[1].cells).toEqual({});
  });

  it("shows each worksheet's own validation entry point after switching", async () => {
    const { user } = await openEditor();

    await dragRange(user, "A1", "A4");
    await clickDataCommand(user, "Data validation");
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Allowed values" }),
      "East,North,South",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Open dropdown for A2" });

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await screen.findByRole("tab", { name: "Sheet2", selected: true });
    expect(screen.queryByRole("button", { name: "Open dropdown for A2" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("tab", { name: "Sheet1", selected: true });
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).not.toBeNull();
  });

  it("reopens on the last active tab with each worksheet's own selected cell", async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await screen.findByRole("tab", { name: "Sheet2", selected: true });
    await user.click(gridCell("B2"));
    await waitFor(() =>
      expect(workbook().worksheets[1].selection).toEqual({
        anchor: { row: 1, col: 1 },
        focus: { row: 1, col: 1 },
      }),
    );

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    await screen.findByRole("tab", { name: "Sheet2", selected: true });
    expect(gridCell("B2").getAttribute("aria-selected")).toBe("true");

    // Sheet1 kept its own (default A1) selection.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("tab", { name: "Sheet1", selected: true });
    expect(gridCell("A1").getAttribute("aria-selected")).toBe("true");
  });
});

describe("adding a worksheet", () => {
  it("appends the next SheetN tab, activates it and leaves the other worksheets unchanged", async () => {
    const { user } = await openEditor();

    const sheet1Grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(sheet1Grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    const active = screen.getByRole("tab", { name: "Sheet3" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const a1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(a1.textContent).toBe("");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("");

    await waitFor(() => expect(workbook().worksheets).toHaveLength(3));
    expect(workbook().worksheets.map((entry) => entry.name)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(workbook().activeWorksheetId).toBe(workbook().worksheets[2].id);
    expect(workbook().worksheets[0].cells.B2).toBe("1200");

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() =>
      expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200"),
    );
    expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("false");
  });

  it("keeps the added worksheet after reopening the workbook", async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));

    view.unmount();
    render(<App />);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("names the second worksheet Sheet2 when Sheet1 is the only worksheet", async () => {
    backend = createMockBackend([
      { ...seedWorkbook(), worksheets: [seedWorkbook().worksheets[0]], activeWorksheetId: "workbook-q3-sales-sheet-1" },
    ]);
    vi.stubGlobal("fetch", backend.fetchImpl);

    const { user } = await openEditor();
    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
    await waitFor(() => expect(workbook().worksheets[1].name).toBe("Sheet2"));
  });
});
