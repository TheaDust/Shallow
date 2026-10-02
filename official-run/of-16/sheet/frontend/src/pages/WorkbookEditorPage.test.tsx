import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "./WorkbookEditorPage";
import { installFakeBackend, type FakeBackend } from "../test/fake-backend";

function selectedNames(): string[] {
  return screen.getAllByRole("gridcell")
    .filter((cell) => cell.getAttribute("aria-selected") === "true")
    .map((cell) => cell.getAttribute("aria-label") ?? "");
}

/** Drags from one corner to the diagonally opposite cell of a rectangle. */
function selectRange(from: string, to: string): void {
  fireEvent.pointerDown(screen.getByRole("gridcell", { name: from }), { button: 0, buttons: 1 });
  fireEvent.pointerEnter(screen.getByRole("gridcell", { name: to }), { buttons: 1 });
  fireEvent.pointerUp(window);
}

/** Selects one cell and submits `text` through the formula bar (Enter commits). */
async function submitFormula(user: ReturnType<typeof userEvent.setup>, cell: string, text: string): Promise<void> {
  await user.click(screen.getByRole("gridcell", { name: cell }));
  const bar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(bar);
  await user.type(bar, `${text}{Enter}`);
}

/** Ctrl+C / Ctrl+X on the grid; returns the text the grid offered to the clipboard. */
function pressTransfer(key: "copy" | "cut"): string {
  let text = "";
  fireEvent[key](screen.getByRole("grid", { name: "Worksheet grid" }), {
    clipboardData: {
      setData: (_type: string, value: string) => { text = value; },
      getData: () => text,
    },
  });
  return text;
}

/** Ctrl+V on the grid with the given clipboard text. */
function pressPaste(text: string): void {
  fireEvent.paste(screen.getByRole("grid", { name: "Worksheet grid" }), {
    clipboardData: { getData: () => text },
  });
}

function toolbarButton(name: string): HTMLElement {
  return within(screen.getByRole("toolbar")).getByRole("button", { name });
}

/** jsdom's Blob has no text() helper, so read the download through FileReader. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the downloaded CSV."));
    reader.readAsText(blob);
  });
}

/** Captures the browser download started by the export button. */
function stubDownload() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const url = URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (value: string) => void;
  };
  url.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return "blob:mock-download";
  };
  url.revokeObjectURL = () => {};
  const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return {
    blobs,
    names,
    restore() {
      spy.mockRestore();
      delete url.createObjectURL;
      delete url.revokeObjectURL;
    },
  };
}

describe("workbook editor page", () => {
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

  it("renders the workbook title, last updated value, worksheet tabs and grid roles", async () => {
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Q3 Sales" })).toBeTruthy();
    expect(screen.getByText("Last updated: 2026-09-29 09:15 UTC")).toBeTruthy();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "B4" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");
  });

  it("keeps a rectangular shift selection inside the region only", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    const a1 = await screen.findByRole("gridcell", { name: "A1" });
    await user.click(a1);
    await user.keyboard("{Shift>}{ArrowDown}{ArrowRight}{/Shift}");

    expect(selectedNames().sort()).toEqual(["A1", "A2", "B1", "B2"]);
    expect(screen.getByRole("gridcell", { name: "C1" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("gridcell", { name: "A3" }).getAttribute("aria-selected")).toBe("false");
  });

  it("switches worksheets and restores the last active worksheet from the stored state", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));

    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    // The other worksheet keeps its own seeded content.
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "2");
    expect(backend.workbooks[0].activeWorksheetId).toBe("q3-sales-sheet2");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    expect(await screen.findByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
  });

  it("saves a renamed workbook and rejects an empty name without changing the record", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("button", { name: "Rename workbook" }));
    const input = screen.getByRole("textbox", { name: "Workbook name" });
    expect(input).toHaveProperty("value", "Q3 Sales");

    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Workbook name cannot be empty");
    expect(screen.getByRole("heading", { level: 1, name: "Q3 Sales" })).toBeTruthy();
    expect(backend.workbooks[0].name).toBe("Q3 Sales");

    await user.type(input, "  Q4 Forecast  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Q4 Forecast" })).toBeTruthy();
    expect(backend.workbooks[0].name).toBe("Q4 Forecast");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Q4 Forecast" })).toBeTruthy();
  });

  it("commits a cell value typed in the formula bar and keeps it after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    const input = await screen.findByRole("textbox", { name: "Formula bar" });
    await user.clear(input);
    await user.type(input, "Central{Enter}");

    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Central");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect(await screen.findByRole("gridcell", { name: "A1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Central");
  });

  it("renames a worksheet from the tab menu and keeps the new name after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    expect(input).toHaveProperty("value", "Sheet2");

    await user.clear(input);
    await user.type(input, "  Region data  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("tab", { name: "Region data" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull();
    expect(backend.workbooks[0].worksheets[1].name).toBe("Region data");
    // The other worksheet keeps its own name and data.
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect(await screen.findByRole("tab", { name: "Region data" })).toBeTruthy();
  });

  it("rejects an empty or duplicate worksheet name and keeps the original tab", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });

    await user.clear(input);
    await user.type(input, "   ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Worksheet name cannot be empty");
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(backend.workbooks[0].worksheets[1].name).toBe("Sheet2");

    await user.clear(input);
    await user.type(input, "Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Worksheet name already exists");
    expect(screen.getByRole("dialog", { name: "Rename worksheet" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(backend.workbooks[0].worksheets[1].name).toBe("Sheet2");
  });

  it("adds a blank worksheet named after the first unused SheetN and selects A1", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("button", { name: "Add worksheet" }));

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "");
    // Existing worksheets keep their data.
    expect(backend.workbooks[0].worksheets[0].cells.A1).toBe("Region");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect(await screen.findByRole("tab", { name: "Sheet3" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("true");
  });

  it("finally names the added worksheet SheetN in positive-integer order", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    await user.clear(input);
    await user.type(input, "Notes");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("tab", { name: "Notes" });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    // Sheet2 is free again, so it is reused before Sheet3.
    expect((await screen.findAllByRole("tab")).map((tab) => tab.textContent)).toEqual(["Sheet1", "Notes", "Sheet2"]);
  });

  it("reports an add failure without adding a tab", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await screen.findAllByRole("tab");
    backend.fetch = (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Could not add a worksheet." }),
      text: async () => JSON.stringify({ error: "Could not add a worksheet." }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not add a worksheet.");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
  });

  it("reports a missing workbook without crashing", async () => {
    render(<WorkbookEditorPage workbookId="does-not-exist" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Workbook not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to workbooks" })).toBeTruthy();
  });

  it("exports the active worksheet as CSV without changing the view state", async () => {
    const user = userEvent.setup();
    const download = stubDownload();
    try {
      render(<WorkbookEditorPage workbookId="q3-sales" />);
      await screen.findByRole("gridcell", { name: "A1" });

      await user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Export CSV" }));

      expect(download.names).toEqual(["Q3 Sales.csv"]);
      expect(download.names[0].endsWith(".csv")).toBe(true);
      expect(await readBlobText(download.blobs[0])).toBe(
        "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open",
      );

      // Export must not touch the workbook or the visible state.
      expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
      expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");
      expect(backend.calls.filter((call) => call.method !== "GET")).toEqual([]);
      expect(backend.workbooks[0].worksheets[0].cells).toEqual({
        A1: "Region",
        B1: "Sales",
        C1: "Status",
        A2: "East",
        B2: "1200",
        C2: "Open",
        A3: "North",
        B3: "800",
        C3: "Closed",
        A4: "South",
        B4: "700",
        C4: "Open",
      });
    } finally {
      download.restore();
    }
  });

  it("exports only the currently active worksheet", async () => {
    const user = userEvent.setup();
    const download = stubDownload();
    try {
      render(<WorkbookEditorPage workbookId="q3-sales" />);
      await screen.findByRole("gridcell", { name: "A1" });

      await user.click(screen.getByRole("tab", { name: "Sheet2" }));
      await user.click(screen.getByRole("button", { name: "Export CSV" }));

      expect(download.names).toEqual(["Q3 Sales.csv"]);
      // The active worksheet exports its own seeded cells in row/column order.
      expect(await readBlobText(download.blobs[0])).toBe("2,3,=A1+B1,=C1*2");
    } finally {
      download.restore();
    }
  });

  it("inserts and deletes rows from the row-number menu and keeps the result after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }), { clientX: 40, clientY: 60 });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("1200");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("North");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");

    // Deleting the inserted row restores the seeded structure.
    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("South");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect(await screen.findByRole("gridcell", { name: "A3" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
  });

  it("keeps another worksheet unchanged while its own row structure changes", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));

    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("North");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("5");
    expect(backend.workbooks[0].worksheets[1].cells).toEqual({
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("East");
  });

  it("inserts and deletes columns from the column-header menu", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "B" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column left" }));

    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("1200");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toBe("800");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "C" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete column" }));
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  });

  it("opens the row menu from the keyboard and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    const header = screen.getByRole("rowheader", { name: "2" });
    header.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(await screen.findByRole("menu", { name: "Row 2 menu" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it("reports a structure failure and leaves the pre-operation grid in place", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    backend.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init.method === "POST" && /\/rows$/.test(url)) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => "application/json" },
          json: async () => ({ error: "Structure index out of range" }),
          text: async () => JSON.stringify({ error: "Structure index out of range" }),
        } as unknown as Response;
      }
      return backend.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Structure index out of range");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    expect(backend.workbooks[0].worksheets[0].cells).toEqual({
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "East",
      B2: "1200",
      C2: "Open",
      A3: "North",
      B3: "800",
      C3: "Closed",
      A4: "South",
      B4: "700",
      C4: "Open",
    });
  });

  it("edits a cell in the grid through the inline box and keeps the value after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    const cell = await screen.findByRole("gridcell", { name: "A2" });
    expect(cell.textContent).toBe("East");
    await user.dblClick(cell);

    // Double-clicking displays an inline text box named "Edit <coordinate>".
    const editor = await screen.findByRole("textbox", { name: "Edit A2" });
    expect(editor).toHaveProperty("value", "East");
    await user.clear(editor);
    await user.type(editor, "Central{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("Central"));
    expect(screen.queryByRole("textbox", { name: "Edit A2" })).toBeNull();
    // Grid and formula bar agree on the same cell.
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Central");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("Central");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "A2" })).textContent).toBe("Central");
  });

  it("starts an inline edit by typing on a selected cell", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("gridcell", { name: "A3" }));
    await user.keyboard("W");

    const editor = await screen.findByRole("textbox", { name: "Edit A3" });
    expect(editor).toHaveProperty("value", "W");
    await user.type(editor, "est{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("West"));
    expect(backend.workbooks[0].worksheets[0].cells.A3).toBe("West");
  });

  it("cancels an uncommitted grid edit with Escape and writes nothing", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.dblClick(await screen.findByRole("gridcell", { name: "A2" }));
    const editor = await screen.findByRole("textbox", { name: "Edit A2" });
    await user.clear(editor);
    await user.type(editor, "Central");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Edit A2" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "East");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("East");
    expect(backend.calls.filter((call) => /\/cells$/.test(call.path))).toEqual([]);
  });

  it("cancels an uncommitted formula bar change with Escape", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    const bar = await screen.findByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "Central");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(backend.workbooks[0].worksheets[0].cells.A1).toBe("Region");
    expect(backend.calls.filter((call) => /\/cells$/.test(call.path))).toEqual([]);
  });

  it("commits the formula bar change when another cell is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    const bar = await screen.findByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "Central");

    await user.click(screen.getByRole("gridcell", { name: "E1" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Central"));
    // The formula bar now shows the newly selected cell, not the old draft.
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "");
    expect(backend.workbooks[0].worksheets[0].cells.A1).toBe("Central");
  });

  it("shows a calculated result in the grid, the original formula in the formula bar, and updates dependents", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("gridcell", { name: "C2" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "=B2*2{Enter}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("2400"));
    // Selecting the formula cell again shows the original submitted formula.
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=B2*2");
    expect(backend.workbooks[0].worksheets[0].cells.C2).toBe("=B2*2");

    // Changing the source recalculates the directly dependent formula.
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    await user.clear(bar);
    await user.type(bar, "1300{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("2600"));

    // An indirectly dependent formula (D2 = C2 + B2) follows as well.
    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    await user.clear(bar);
    await user.type(bar, "=C2+B2{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("3900"));
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    await user.clear(bar);
    await user.type(bar, "1000{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("3000"));

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "C2" })).textContent).toBe("2000");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("3000");
  });

  it("calculates the seeded formulas and aggregate functions over ranges", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));
    // The seeded formulas show their result in the grid and the original
    // expression in the formula bar.
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "B1" }).textContent).toBe("3");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("10");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=A1+B1");
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=C1*2");

    // Constants, parentheses and the aggregate functions, entered through the
    // formula bar (lower-case names included) and the grid's inline editor.
    await submitFormula(user, "A3", "=(2+4)*3-4/2");
    await submitFormula(user, "C3", "=SUM(A1:B1)");
    await submitFormula(user, "C4", "=sum(A1:B1)");
    await submitFormula(user, "A4", "=AVERAGE(A1:B1)");
    await submitFormula(user, "B3", "=COUNT(A1:B1)");
    await submitFormula(user, "B4", "=MIN(A1:B1)");
    await submitFormula(user, "D3", "=MAX(A1:B1)");
    // COUNT counts numeric cells only: B1 is numeric, the blank B2 is not.
    await submitFormula(user, "D4", "=COUNT(B1:B2)");
    await user.dblClick(screen.getByRole("gridcell", { name: "E1" }));
    await user.type(screen.getByRole("textbox", { name: "Edit E1" }), "=B1*2{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("6"));

    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("16");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "C4" }).textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("2.5");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("3");
    expect(screen.getByRole("gridcell", { name: "D4" }).textContent).toBe("1");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("3");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=A1+B1");
  });

  it("recalculates directly and indirectly dependent formulas after a source edit", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));

    await submitFormula(user, "A1", "5");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("8"));
    // The indirectly dependent formula follows the recalculation as well.
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("16");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "5");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=A1+B1");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("8");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("16");
  });

  it("shows stable formula errors, keeps the submitted formula and recovers after an edit", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));

    await submitFormula(user, "A3", "=1/0");
    await submitFormula(user, "B3", "=NOPE(1)");
    await submitFormula(user, "C3", "=1+");
    await submitFormula(user, "D3", "=A0");
    await submitFormula(user, "A4", "=B4");
    await submitFormula(user, "B4", "=A4");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("#REF!"));
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("#DIV/0!");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("#NAME?");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toBe("#ERROR!");
    expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("#REF!");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("#REF!");

    // The error cells keep their submitted formula and leave the other cells usable.
    await user.click(screen.getByRole("gridcell", { name: "A3" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=1/0");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("5");
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("10");

    // Changing the error cell to a valid formula shows the new result everywhere.
    await submitFormula(user, "A3", "=1+1");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("2"));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=1+1");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("#NAME?");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await user.click(await screen.findByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("#REF!");
    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=NOPE(1)");
  });

  it("reports a failed commit and keeps the last successful value and results", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "=B2*2{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("2400"));

    const baseFetch = backend.fetch;
    backend.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init.method === "PATCH" && /\/cells$/.test(url)) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => "application/json" },
          json: async () => ({ error: "Cell write rejected" }),
          text: async () => JSON.stringify({ error: "Cell write rejected" }),
        } as unknown as Response;
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    await user.clear(bar);
    await user.type(bar, "9999{Enter}");

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Cell write rejected");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "1200");
    expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("2400");
    expect(backend.workbooks[0].worksheets[0].cells.B2).toBe("1200");
  });

  it("commits an inline grid edit when another cell is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.dblClick(await screen.findByRole("gridcell", { name: "A2" }));
    const editor = await screen.findByRole("textbox", { name: "Edit A2" });
    await user.clear(editor);
    await user.type(editor, "Central");

    await user.click(screen.getByRole("gridcell", { name: "E1" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("Central"));
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("Central");
    // The formula bar follows the newly selected cell, not the finished draft.
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "");
  });

  it("clears a selected cell with the Delete key", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("gridcell", { name: "A3" }));
    await user.keyboard("{Delete}");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe(""));
    expect(backend.workbooks[0].worksheets[0].cells.A3).toBeUndefined();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  });

  it("pastes tab-separated rows into the starting cell and keeps them after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("gridcell", { name: "D1" }));
    fireEvent.paste(screen.getByRole("grid", { name: "Worksheet grid" }), {
      clipboardData: { getData: () => "East\t1200\nNorth\t800" },
    });

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("800"));
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("1200");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("North");
    // Cells outside the target rectangle keep their values.
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(backend.workbooks[0].worksheets[0].cells.E2).toBe("800");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "D1" })).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("800");
  });

  it("preserves empty paste fields and replaces formulas with their recalculated results", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);

    await user.click(await screen.findByRole("gridcell", { name: "D1" }));
    fireEvent.paste(screen.getByRole("grid", { name: "Worksheet grid" }), {
      clipboardData: { getData: () => "1\t2\n3\t4" },
    });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("4"));

    // A later paste with an empty trailing field clears that target cell.
    fireEvent.paste(screen.getByRole("grid", { name: "Worksheet grid" }), {
      clipboardData: { getData: () => "East\t1200\nNorth\t" },
    });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe(""));
    expect(backend.workbooks[0].worksheets[0].cells.E2).toBeUndefined();

    // Formulas inside the rectangle are replaced by the pasted content.
    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "=B2*2{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("2400"));

    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    fireEvent.paste(screen.getByRole("grid", { name: "Worksheet grid" }), {
      clipboardData: { getData: () => "7" },
    });
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("7"));
    expect(backend.workbooks[0].worksheets[0].cells.C2).toBe("7");
  });

  it("reports a rejected paste and keeps every target cell", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "D1" });

    const baseFetch = backend.fetch;
    backend.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init.method === "PATCH" && /\/cells$/.test(url)) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => "application/json" },
          json: async () => ({ error: "Please enter a number from 0 to 100" }),
          text: async () => JSON.stringify({ error: "Please enter a number from 0 to 100" }),
        } as unknown as Response;
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    fireEvent.paste(screen.getByRole("grid", { name: "Worksheet grid" }), {
      clipboardData: { getData: () => "East\t1200\nNorth\t800" },
    });

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Please enter a number from 0 to 100",
    );
    expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("");
    expect(backend.workbooks[0].worksheets[0].cells.D1).toBeUndefined();
    expect(backend.workbooks[0].worksheets[0].cells.E2).toBeUndefined();
  });

  it("offers Paste in the cell context menu and applies the clipboard text", async () => {
    const user = userEvent.setup();
    const clipboard = { readText: async () => "East\t1200\nNorth\t800" };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    try {
      render(<WorkbookEditorPage workbookId="q3-sales" />);
      await screen.findByRole("gridcell", { name: "D1" });

      fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }), { clientX: 30, clientY: 40 });
      const menu = await screen.findByRole("menu");
      expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "Copy",
        "Cut",
        "Paste",
      ]);
      await user.click(within(menu).getByRole("menuitem", { name: "Paste" }));

      await waitFor(() => expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("800"));
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("East");
      expect(backend.workbooks[0].worksheets[0].cells.E2).toBe("800");
    } finally {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it("falls back to a paste box when the clipboard cannot be read", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: async () => { throw new Error("denied"); } },
      configurable: true,
    });
    try {
      render(<WorkbookEditorPage workbookId="q3-sales" />);
      await screen.findByRole("gridcell", { name: "D1" });

      await user.click(screen.getByRole("gridcell", { name: "D1" }));
      fireEvent.contextMenu(screen.getByRole("gridcell", { name: "D1" }));
      await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

      const dialog = await screen.findByRole("dialog", { name: "Paste" });
      const box = within(dialog).getByRole("textbox", { name: "Paste data" });
      fireEvent.change(box, { target: { value: "East\t1200" } });
      await user.click(within(dialog).getByRole("button", { name: "Paste" }));

      await waitFor(() => expect(screen.getByRole("gridcell", { name: "E1" }).textContent).toBe("1200"));
      expect(screen.getByRole("gridcell", { name: "D1" }).textContent).toBe("East");
    } finally {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  it("selects a rectangle by dragging and persists the complete selection", async () => {
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    const b2 = await screen.findByRole("gridcell", { name: "B2" });
    const d4 = screen.getByRole("gridcell", { name: "D4" });

    fireEvent.pointerDown(b2, { button: 0, buttons: 1 });
    fireEvent.pointerEnter(d4, { buttons: 1 });
    fireEvent.pointerUp(window);

    expect(selectedNames().sort()).toEqual(["B2", "B3", "B4", "C2", "C3", "C4", "D2", "D3", "D4"]);
    expect(screen.getByRole("gridcell", { name: "E2" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("grid", { name: "Worksheet grid" }).getAttribute("aria-multiselectable")).toBe("true");

    await waitFor(() => expect(backend.workbooks[0].selections["q3-sales-sheet1"]).toEqual({
      anchor: { row: 1, col: 1 },
      focus: { row: 3, col: 3 },
    }));

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    expect(selectedNames().sort()).toEqual(["B2", "B3", "B4", "C2", "C3", "C4", "D2", "D3", "D4"]);
  });

  it("replaces the selection on a new click and keeps each worksheet\u2019s own rectangle", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    const b2 = await screen.findByRole("gridcell", { name: "B2" });

    fireEvent.pointerDown(b2, { button: 0, buttons: 1 });
    fireEvent.pointerEnter(screen.getByRole("gridcell", { name: "C3" }), { buttons: 1 });
    fireEvent.pointerUp(window);
    expect(selectedNames().sort()).toEqual(["B2", "B3", "C2", "C3"]);

    await user.click(screen.getByRole("gridcell", { name: "A5" }));
    expect(selectedNames()).toEqual(["A5"]);

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(selectedNames()).toEqual(["A1"]);
    expect(backend.workbooks[0].selections["q3-sales-sheet1"]).toEqual({
      anchor: { row: 4, col: 0 },
      focus: { row: 4, col: 0 },
    });

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(selectedNames()).toEqual(["A5"]);
  });

  it("copies a rectangle and pastes it at the selected target while the source stays", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A2", "B3");
    const text = pressTransfer("copy");
    expect(text).toBe("East\t1200\nNorth\t800");
    // Copying on its own changes nothing.
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("East");

    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    pressPaste(text);

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E3" }).textContent).toBe("800"));
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "E2" }).textContent).toBe("1200");
    expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("North");
    // The source rectangle and unrelated cells keep their values.
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("800");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    // The complete target rectangle is the current selection.
    expect(selectedNames().sort()).toEqual(["D2", "D3", "E2", "E3"]);

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "D2" })).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "E3" }).textContent).toBe("800");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(selectedNames().sort()).toEqual(["D2", "D3", "E2", "E3"]);
  });

  it("clears the cut source only once the target range has been pasted", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A2", "B3");
    const text = pressTransfer("cut");
    expect(text).toBe("East\t1200\nNorth\t800");
    // Cutting alone keeps the complete source displayed and stored.
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("800");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("East");

    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    pressPaste(text);

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E3" }).textContent).toBe("800"));
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "B3" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("East");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBeUndefined();

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "A2" })).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("East");
  });

  it("adjusts relative references of copied formulas and keeps absolute ones", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    const bar = await screen.findByRole("textbox", { name: "Formula bar" });

    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    await user.clear(bar);
    await user.type(bar, "=B2*2{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "C2" }).textContent).toBe("2400"));
    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    await user.clear(bar);
    await user.type(bar, "=$B$2+1{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("1201"));

    selectRange("C2", "D2");
    const text = pressTransfer("copy");
    await user.click(screen.getByRole("gridcell", { name: "C3" }));
    pressPaste(text);

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("1201"));
    // The relative reference follows the target offset; the absolute one does not.
    await user.click(screen.getByRole("gridcell", { name: "C3" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=B3*2");
    expect(screen.getByRole("gridcell", { name: "C3" }).textContent).toBe("1600");
    await user.click(screen.getByRole("gridcell", { name: "D3" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=$B$2+1");
    // The copied source keeps its own formula and result.
    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=B2*2");
    expect(backend.workbooks[0].worksheets[0].cells.C3).toBe("=B3*2");
  });

  it("refuses a range paste in another worksheet and leaves it unchanged", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A2", "B3");
    const text = pressTransfer("copy");
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    pressPaste(text);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Copying and pasting is only supported within the same worksheet.",
    );
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(backend.workbooks[0].worksheets[1].cells).toEqual({
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });
  });

  it("shows the validation error for a rejected range paste and keeps both ranges", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A2", "B3");
    const text = pressTransfer("cut");
    await user.click(screen.getByRole("gridcell", { name: "D2" }));

    const baseFetch = backend.fetch;
    backend.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init.method === "PATCH" && /\/cells$/.test(url)) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => "application/json" },
          json: async () => ({ error: "Please enter a number from 0 to 100" }),
          text: async () => JSON.stringify({ error: "Please enter a number from 0 to 100" }),
        } as unknown as Response;
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    pressPaste(text);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Please enter a number from 0 to 100",
    );
    // Neither the target nor the cut source changed.
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("East");
    expect(backend.workbooks[0].worksheets[0].cells.D2).toBeUndefined();
  });

  it("copies and pastes the selected rectangle from the toolbar buttons", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    selectRange("A2", "B3");
    await user.click(toolbarButton("Copy"));
    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    await user.click(toolbarButton("Paste"));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E3" }).textContent).toBe("800"));
    expect(screen.getByRole("gridcell", { name: "D2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  });

  it("copies the selected rectangle on Ctrl+C while the formula bar has focus", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    const bar = await screen.findByRole("textbox", { name: "Formula bar" });

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    bar.focus();
    let text = "";
    fireEvent.copy(bar, {
      clipboardData: {
        setData: (_type: string, value: string) => { text = value; },
        getData: () => text,
      },
    });
    expect(text).toBe("East");

    await user.click(screen.getByRole("gridcell", { name: "D5" }));
    pressPaste(text);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D5" }).textContent).toBe("East"));
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");

    // An open draft keeps the browser's own copy of the text control.
    await user.type(bar, "Central");
    let draftCopy = "";
    fireEvent.copy(bar, {
      clipboardData: {
        setData: (_type: string, value: string) => { draftCopy = value; },
        getData: () => draftCopy,
      },
    });
    expect(draftCopy).toBe("");
    await user.keyboard("{Escape}");
  });

  it("pastes the app clipboard on Ctrl+V even when the system clipboard is empty", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // An empty paste without an app clipboard does nothing at all.
    pressPaste("");
    expect(screen.queryByRole("dialog")).toBeNull();

    selectRange("A2", "B3");
    await user.click(toolbarButton("Cut"));
    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    pressPaste("");

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "E3" }).textContent).toBe("800"));
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
    expect(screen.getByRole("gridcell", { name: "D3" }).textContent).toBe("North");
  });

  it("undoes and redoes a committed cell edit from the toolbar and the keyboard", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    const bar = await screen.findByRole("textbox", { name: "Formula bar" });

    expect(toolbarButton("Undo")).toHaveProperty("disabled", true);
    expect(toolbarButton("Redo")).toHaveProperty("disabled", true);

    await user.clear(bar);
    await user.type(bar, "Central{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Central"));
    expect(toolbarButton("Undo")).toHaveProperty("disabled", false);

    await user.click(toolbarButton("Undo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region"));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");
    expect(backend.workbooks[0].worksheets[0].cells.A1).toBe("Region");
    expect(toolbarButton("Redo")).toHaveProperty("disabled", false);

    await user.click(toolbarButton("Redo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Central"));

    // Ctrl+Z and Ctrl+Y drive the same history.
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region"));
    await user.keyboard("{Control>}y{/Control}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Central"));

    // A new modification drops the redo branch.
    await user.clear(bar);
    await user.type(bar, "Coastal{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Coastal"));
    expect(toolbarButton("Redo")).toHaveProperty("disabled", true);
    await user.keyboard("{Control>}y{/Control}");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Coastal");

    // The undone/redone state itself is persisted, not the history.
    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "A1" })).textContent).toBe("Coastal");
    expect(toolbarButton("Undo")).toHaveProperty("disabled", true);
  });

  it("restores consecutive operations in reverse order", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    const bar = await screen.findByRole("textbox", { name: "Formula bar" });

    await user.clear(bar);
    await user.type(bar, "One{Enter}");
    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    await user.clear(bar);
    await user.type(bar, "Two{Enter}");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("Two"));

    await user.click(toolbarButton("Undo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East"));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("One");

    await user.click(toolbarButton("Undo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region"));

    await user.click(toolbarButton("Redo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("One"));
    await user.click(toolbarButton("Redo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("Two"));
  });

  it("undoes and redoes row and column structure changes", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }), { clientX: 40, clientY: 60 });
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("East"));

    await user.click(toolbarButton("Undo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East"));
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    // The restore only touched the worksheet of the operation.
    expect(backend.calls.filter((call) => call.method === "PUT").every((call) => call.path.includes("q3-sales-sheet1"))).toBe(true);
    expect(backend.workbooks[0].worksheets[1].cells).toEqual({
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
    });

    await user.click(toolbarButton("Redo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe(""));
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("East");
  });

  it("undoes a range move and a bulk paste, restoring the previous values", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // A bulk paste of external clipboard text.
    pressPaste("1\t2\n3\t4");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("4"));

    await user.click(toolbarButton("Undo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region"));
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(backend.workbooks[0].worksheets[0].cells.A1).toBe("Region");

    await user.click(toolbarButton("Redo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("1"));

    selectRange("A1", "B1");
    const moved = pressTransfer("cut");
    expect(moved).toBe("1\t2");
    await user.click(screen.getByRole("gridcell", { name: "A4" }));
    pressPaste(moved);
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("2"));
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");

    await user.click(toolbarButton("Undo"));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("1"));
    expect(screen.getByRole("gridcell", { name: "B1" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("700");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect((await screen.findByRole("gridcell", { name: "A1" })).textContent).toBe("1");
    expect(screen.getByRole("gridcell", { name: "B4" }).textContent).toBe("700");
  });

  it("switches the selected cell, grid and formula bar between worksheets and keeps the source unchanged", async () => {
    const user = userEvent.setup();
    // Sheet2 has no stored selection yet, so opening it must fall back to A1.
    delete backend.workbooks[0].selections["q3-sales-sheet2"];
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // Sheet1: row 2 column B is the selected cell and its text is in the formula bar.
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "1200");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    // The grid shows Sheet2's own content, with A1 selected and displayed.
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "2");
    // The formula bar shows the original formula text of a selected formula cell.
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "=A1+B1");

    // Returning to Sheet1 restores its own selected cell and value.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "C1" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("gridcell", { name: "C1" }).textContent).toBe("Status");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "1200");
    // Sheet1 keeps every seeded value and Sheet2 keeps its own formula row.
    expect(backend.workbooks[0].worksheets[0].cells).toEqual({
      A1: "Region", B1: "Sales", C1: "Status",
      A2: "East", B2: "1200", C2: "Open",
      A3: "North", B3: "800", C3: "Closed",
      A4: "South", B4: "700", C4: "Open",
    });
    expect(backend.workbooks[0].worksheets[1].cells).toEqual({ A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
    expect(backend.workbooks[0].selections["q3-sales-sheet1"]).toEqual({
      anchor: { row: 1, col: 1 },
      focus: { row: 1, col: 1 },
    });
  });

  it("deletes a worksheet from the tab menu, activates an adjacent tab and keeps it deleted after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // Sheet1 is active; its tab menu offers the Delete command.
    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Rename", "Delete"]);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    // Nothing is removed before the confirmation is accepted.
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(dialog.textContent).toContain("Sheet1");
    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
    expect(backend.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1", "Sheet2"]);
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet2"]);
    // The neighbouring worksheet is active and shows its own grid.
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("2");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "2");
    expect(backend.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet2"]);

    // The removed tab and its data stay gone after reopening.
    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    expect(await screen.findByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
  });

  it("keeps the other worksheet active with its own data while a neighbouring tab is deleted", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // Delete the non-active Sheet2 while a draft is pending on Sheet1.
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" });
    await user.clear(bar);
    await user.type(bar, "1500");

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());
    // Sheet1 was not the target: it stays active, keeps its grid and takes the draft.
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(backend.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1"]);
    expect(backend.workbooks[0].worksheets[0].cells.B2).toBe("1500");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1500");
    expect(backend.workbooks[0].selections["q3-sales-sheet2"]).toBeUndefined();
  });

  it("refuses to delete the last worksheet without opening the confirmation", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // Remove Sheet2 so a single tab remains.
    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet2" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // No confirmation opens; the rule is reported and the tab stays.
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "A workbook must contain at least one worksheet");
    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1"]);
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(backend.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1"]);
  });

  it("reports a deletion failure and keeps the target tab and its grid", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    backend.fetch = (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "Could not delete the worksheet." }),
      text: async () => JSON.stringify({ error: "Could not delete the worksheet." }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", backend.fetch);

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not delete the worksheet.");
    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveProperty("value", "Region");
  });

  it("rejects deleting a worksheet a pivot table still reads and keeps both worksheets", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    // Create a pivot result worksheet from Sheet1's seeded sales region.
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(within(await screen.findByRole("menu", { name: "Data" })).getByRole("menuitem", { name: "Create pivot table" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Create pivot table" })).getByRole("button", { name: "Create" }));
    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Rows" }), "Region");
    await user.selectOptions(within(editor).getByRole("combobox", { name: "Values" }), "Sales");
    await user.click(within(editor).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region"));
    const pivotCells = { ...backend.workbooks[0].worksheets[2].cells };

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));

    // The confirmation closes, the rule is reported and nothing changed.
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Please delete or rebuild dependent pivot tables first");
    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Pivot1"]);
    expect(backend.workbooks[0].worksheets[0].cells.A2).toBe("East");
    expect(backend.workbooks[0].worksheets[2].cells).toEqual(pivotCells);

    // Deleting the pivot result frees its source, which can then be removed.
    await user.click(screen.getByRole("button", { name: "Worksheet options for Pivot1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Pivot1" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Worksheet options for Sheet1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete worksheet" })).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull());
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet2"]);
  });
});
