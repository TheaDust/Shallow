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

/** Creates a filter over the selected region through the Data menu. */
async function createFilter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Create filter" }));
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

describe("creating a filter", () => {
  it("puts one 'Filter <header>' button in every header of the filtered region", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "C4");
    await createFilter(user);

    expect(await screen.findByRole("button", { name: "Filter Region" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Filter Sales" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Filter Status" })).not.toBeNull();
    expect(queryCell("A2")).not.toBeNull();

    await waitFor(() => expect(worksheet().filter?.range).toEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 }));
  });

  it("filters by the selected source values and only hides the nonmatching records", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "A1", "C4");
    await createFilter(user);

    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    // One checkbox per distinct source value, named after the displayed value.
    expect(within(dialog).getAllByRole("checkbox").map((box) => box.parentElement?.textContent)).toEqual([
      "East",
      "North",
      "South",
    ]);
    expect(within(dialog).getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);

    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "South" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(queryCell("A3")).toBeNull());
    expect(queryCell("A4")).toBeNull();
    expect(queryCell("A2")).not.toBeNull();
    expect(gridCell("B2").textContent).toBe("1200");
    // Filtering hides rows only: the worksheet keeps every record.
    expect(worksheet().cells.A3).toBe("North");
    expect(worksheet().cells.A4).toBe("South");

    // The same rows stay hidden after reopening the workbook.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.unmount();
    const reopened = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(within(grid()).queryByRole("gridcell", { name: "A3" })).toBeNull();
    expect(within(grid()).getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(within(grid()).getByRole("button", { name: "Filter Region" })).not.toBeNull();
    reopened.unmount();
  });

  it("filters by the named conditions and combines columns with AND", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "C4");
    await createFilter(user);

    await user.click(await screen.findByRole("button", { name: "Filter Sales" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Sales" });
    await user.click(within(dialog).getByRole("combobox", { name: "Condition" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Text contains",
      "Greater than",
      "Before",
      "Is empty",
      "Is not empty",
    ]);
    await user.click(screen.getByRole("option", { name: "Greater than" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Value" }), "1000");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(queryCell("A3")).toBeNull());
    expect(queryCell("A4")).toBeNull();
    expect(queryCell("A2")).not.toBeNull();

    // A second column narrows the visible rows further (AND).
    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    const second = await screen.findByRole("dialog", { name: "Filter Region" });
    await chooseOption(user, "Condition", "Text contains");
    await user.type(within(second).getByRole("textbox", { name: "Value" }), "orth");
    await user.click(within(second).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(queryCell("A2")).toBeNull());
    expect(worksheet().cells.A2).toBe("East");
    expect(worksheet().filter?.columns).toEqual([
      { col: 0, kind: "condition", operator: "contains", value: "orth" },
      { col: 1, kind: "condition", operator: "greaterThan", value: "1000" },
    ]);
  });

  it("clears the filter and restores every record in its original order", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "A1", "C4");
    await createFilter(user);

    await user.click(await screen.findByRole("button", { name: "Filter Status" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Status" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Closed" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(queryCell("A3")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(await screen.findByRole("menuitem", { name: "Clear filter" }));

    await waitFor(() => expect(queryCell("A3")).not.toBeNull());
    expect(["A2", "A3", "A4"].map((name) => gridCell(name).textContent)).toEqual(["East", "North", "South"]);
    expect(["B2", "B3", "B4"].map((name) => gridCell(name).textContent)).toEqual(["1200", "800", "700"]);
    expect(worksheet().filter).toBeNull();

    // After a refresh every record is still visible.
    view.unmount();
    const reopened = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(["A2", "A3", "A4"].map((name) => gridCell(name).textContent)).toEqual(["East", "North", "South"]);
    expect(within(grid()).queryByRole("button", { name: "Filter Region" })).toBeNull();
    reopened.unmount();
  });

  it("keeps the filter of one worksheet out of the other worksheets", async () => {
    const { user } = await openEditor();
    await dragRange(user, "A1", "C4");
    await createFilter(user);

    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(queryCell("A2")).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await screen.findByRole("tab", { name: "Sheet2", selected: true });
    expect(within(grid()).queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(worksheet(1).filter ?? null).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A2" })).toBeNull());
    expect(worksheet().cells.A2).toBe("East");
  });

  it("keeps hidden records in the CSV export and in the worksheet itself", async () => {
    const { user, view } = await openEditor();
    await dragRange(user, "A1", "C4");
    await createFilter(user);

    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(queryCell("A3")).toBeNull());

    const created: Blob[] = [];
    const downloads: string[] = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob);
      return "blob:csv";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
      reader.readAsText(created[0], "utf-8");
    });
    expect(text).toBe("Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open");

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;

    // The export left the filter view and the records exactly as they were.
    expect(queryCell("A3")).toBeNull();
    expect(worksheet().cells.A3).toBe("North");
    view.unmount();
  });
});
