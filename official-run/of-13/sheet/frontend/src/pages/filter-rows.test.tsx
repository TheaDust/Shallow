/**
 * REQ-5-1-2: the `Data` menu commands, the `Filter <header text>` dialog and the effect of a
 * filter view on the grid. The stored definition and the hidden row numbers come from the
 * server double, which mirrors `backend/src/domain/filter.mjs`.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { SHEET1, WORKBOOK_ID, installFakeWorkbookApi } from "../test/fake-workbook-api";

async function openEditor() {
  window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
  const view = render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return view;
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

/** A hidden row leaves the accessibility tree, so `queryByRole` is how the tests see it. */
function hiddenCell(address: string) {
  return within(grid()).queryByRole("gridcell", { name: address });
}

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

async function openDataMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.getByRole("menu", { name: "Data" });
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("the Data menu", () => {
  it("sits in the workbook toolbar and offers the data commands as menuitems", async () => {
    installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    const trigger = screen.getByRole("button", { name: "Data" });
    expect(trigger.closest('[role="toolbar"]')).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Data" });
    for (const name of ["Create filter", "Clear filter", "Data validation"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeTruthy();
    }
  });
});

describe("filtering rows by value", () => {
  it("adds a Filter button per header and hides only the unselected rows", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(within(await openDataMenu(user)).getByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(api.workbooks[0].sheets[0].filter).toBeDefined());
    // The whole seeded region is covered, header row included.
    expect(api.workbooks[0].sheets[0].filter?.range).toBe("A1:C4");
    for (const header of ["Region", "Sales", "Status"]) {
      expect(screen.getByRole("button", { name: `Filter ${header}` })).toBeTruthy();
    }
    // The header cell still shows its own text and keeps its A1 name.
    expect(cell("A1").textContent).toBe("Region");

    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    for (const value of ["East", "North", "South"]) {
      expect(within(dialog).getByRole("checkbox", { name: value })).toBeTruthy();
    }
    expect(within(dialog).getByRole("button", { name: "Clear selection" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Apply" })).toBeTruthy();
    const condition = within(dialog).getByLabelText("Condition");
    for (const option of ["Text contains", "Greater than", "Before", "Is empty", "Is not empty"]) {
      expect(within(condition as HTMLElement).getByRole("option", { name: option })).toBeTruthy();
    }
    expect(within(dialog).getByLabelText("Value")).toBeTruthy();

    // Unchecking North keeps the other two regions visible.
    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(hiddenCell("A3")).toBeNull());
    expect(cell("A2").textContent).toBe("East");
    expect(cell("A4").textContent).toBe("South");
    expect(api.workbooks[0].sheets[0].filter?.columns).toEqual([
      { column: "A", mode: "values", values: ["East", "South"] },
    ]);
    // Hiding a row never changes the stored record.
    expect(api.workbooks[0].sheets[0].cells.A3).toBe("North");
    expect(api.workbooks[0].sheets[0].cells.B3).toBe("800");

    // Reopening the workbook keeps exactly the same rows visible.
    window.location.hash = "#/";
    window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
    await waitFor(() => expect(hiddenCell("A3")).toBeNull());
    expect(cell("A2").textContent).toBe("East");
    expect(cell("A4").textContent).toBe("South");
  });

  it("combines conditions of different columns with AND and clears them again", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    await openEditor();

    await user.click(within(await openDataMenu(user)).getByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(api.workbooks[0].sheets[0].filter).toBeDefined());

    await user.click(screen.getByRole("button", { name: "Filter Sales" }));
    let dialog = await screen.findByRole("dialog", { name: "Filter Sales" });
    await user.selectOptions(within(dialog).getByLabelText("Condition"), "Greater than");
    await user.type(within(dialog).getByLabelText("Value"), "750");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(hiddenCell("B4")).toBeNull());
    expect(cell("B2").textContent).toBe("1200");
    expect(cell("B3").textContent).toBe("800");

    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.selectOptions(within(dialog).getByLabelText("Condition"), "Text contains");
    await user.type(within(dialog).getByLabelText("Value"), "th");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    // North matches both conditions; the other two rows fail one of them.
    await waitFor(() => expect(hiddenCell("A2")).toBeNull());
    expect(hiddenCell("A4")).toBeNull();
    expect(cell("A3").textContent).toBe("North");

    await user.click(
      within(await openDataMenu(user)).getByRole("menuitem", { name: "Clear filter" }),
    );
    await waitFor(() => expect(hiddenCell("A2")).not.toBeNull());
    for (const address of ["A1", "A2", "A3", "A4", "B4", "C4"]) {
      expect(cell(address)).toBeTruthy();
    }
    expect(api.workbooks[0].sheets[0].cells.B4).toBe("700");
    expect(api.workbooks[0].sheets[0].filter).toBeUndefined();
  });

  it("keeps hidden rows in the CSV export and unaffected by other worksheets", async () => {
    const api = installFakeWorkbookApi();
    const user = userEvent.setup();
    const downloads: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        downloads.push(blob);
        return "blob:test";
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openEditor();

    await user.click(within(await openDataMenu(user)).getByRole("menuitem", { name: "Create filter" }));
    await waitFor(() => expect(api.workbooks[0].sheets[0].filter).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getByRole("checkbox", { name: "North" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(hiddenCell("A3")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await expect(readBlobText(downloads[0])).resolves.toContain("North,800,Closed");

    // The other worksheet keeps its own state and never inherits the filter.
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await screen.findByLabelText("Formula bar");
    expect(within(grid()).getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(within(grid()).queryByRole("button", { name: "Filter Region" })).toBeNull();
    expect(api.workbooks[0].sheets.find((sheet) => sheet.id === SHEET1)?.hiddenRows).toEqual([3]);
  });
});

/** jsdom lacks `Blob.text`; the CSV export assertion reads the blob through FileReader. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob, "utf-8");
  });
}
