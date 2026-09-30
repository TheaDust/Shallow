import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createFakeApi, type FakeApi } from "./test/fakeApi";
import { readFileText } from "./workbooks/file";

let api: FakeApi;
let user: ReturnType<typeof userEvent.setup>;

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  api = createFakeApi();
  vi.stubGlobal("fetch", api.fetch);
  window.location.hash = "#/";
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSeedWorkbook() {
  renderApp();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

function attributeOf(element: Element, name: string): string | null {
  return element.getAttribute(name);
}

describe("workbook home page", () => {
  it("lists every workbook with its name as a link and its last updated value", async () => {
    renderApp();

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(attributeOf(link, "href")).toBe("#/workbooks/wb_q3_sales");
    expect(screen.getByText("Last updated: 2026-09-28 10:15")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeTruthy();
  });
});

describe("opening a workbook", () => {
  it("shows the workbook name, last updated value, tabs and grid for the opened workbook", async () => {
    await openSeedWorkbook();

    expect(screen.getByText("Last updated: 2026-09-28 10:15")).toBeTruthy();
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(attributeOf(grid, "aria-multiselectable")).toBe("true");
    const a1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(a1.textContent).toBe("Region");
    expect(attributeOf(a1, "aria-selected")).toBe("true");
    expect(attributeOf(within(grid).getByRole("gridcell", { name: "B1" }), "aria-selected")).toBe("false");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
  });

  it("selects the clicked cell and clears the previous selection", async () => {
    await openSeedWorkbook();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    await user.click(within(grid).getByRole("gridcell", { name: "B2" }));

    expect(attributeOf(within(grid).getByRole("gridcell", { name: "B2" }), "aria-selected")).toBe("true");
    expect(attributeOf(within(grid).getByRole("gridcell", { name: "A1" }), "aria-selected")).toBe("false");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("1200");
  });

  it("keeps the saved workbook state after a refresh of the same editor entry", async () => {
    await openSeedWorkbook();
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.clear(formulaBar);
    await user.type(formulaBar, "West{Enter}");
    await waitFor(() => expect(api.state.workbooks[0].worksheets[0].cells.A1.value).toBe("West"));

    cleanup();
    renderApp();

    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("West");
  });

  it("restores the last active worksheet after a refresh", async () => {
    const second = api.state.workbooks[0].worksheets[1];
    expect(second.name).toBe("Sheet2");
    second.cells = { A1: { value: "Second sheet" } };

    await openSeedWorkbook();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(api.state.workbooks[0].activeWorksheetId).toBe("ws_q3_sales_sheet2"));

    cleanup();
    renderApp();

    expect(attributeOf(await screen.findByRole("tab", { name: "Sheet2" }), "aria-selected")).toBe("true");
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("false");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Second sheet");
  });
});

describe("creating a workbook", () => {
  it("creates a blank workbook from the creation page and opens its Sheet1 editor", async () => {
    renderApp();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));

    await user.type(await screen.findByRole("textbox", { name: "Workbook name" }), "Q4 Plan");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("heading", { name: "Q4 Plan" });
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");
    const a1 = screen.getByRole("gridcell", { name: "A1" });
    expect(attributeOf(a1, "aria-selected")).toBe("true");
    expect(a1.textContent).toBe("");
    expect(api.state.workbooks.map((workbook) => workbook.name)).toContain("Q4 Plan");

    await user.click(screen.getByRole("link", { name: "All workbooks" }));
    expect(await screen.findByRole("link", { name: "Q4 Plan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Q3 Sales" })).toBeTruthy();
  });

  it("keeps the creation page usable and adds no record when the request fails", async () => {
    renderApp();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    api.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Workbook could not be created" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    await user.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Workbook could not be created");
    expect(api.state.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales"]);
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("textbox", { name: "Workbook name" })).toBeTruthy();
  });
});

describe("importing CSV data", () => {
  async function openImportDialog() {
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    return screen.findByRole("dialog", { name: "Import CSV" });
  }

  it("imports a CSV file into a new workbook and opens Sheet1 with all rows", async () => {
    const dialog = await openImportDialog();
    const file = new File(['地区,备注\n华东,"东, 1"\n"多行\n备注",800\n'], "Q3 明细.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText("CSV file"), file);
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    await screen.findByRole("heading", { name: "Q3 明细" });
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("地区");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("东, 1");
    expect(within(grid).getByRole("gridcell", { name: "A3" }).textContent).toBe("多行\n备注");
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");
  });

  it("rejects an invalid CSV file without adding a workbook link", async () => {
    const dialog = await openImportDialog();
    const file = new File(['a,b\n"unclosed,2\n'], "broken.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText("CSV file"), file);
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect(await within(dialog).findByText("Invalid CSV file format. Import failed.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("link", { name: "broken" })).toBeNull();
    expect(api.state.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales"]);
  });
});

describe("renaming a workbook", () => {
  async function openRenameDialog() {
    await openSeedWorkbook();
    await user.click(screen.getByRole("button", { name: "Rename workbook" }));
    return screen.getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  }

  it("renames from the editor title and keeps the new name on the home page and after refresh", async () => {
    const input = await openRenameDialog();
    expect(input.value).toBe("Q3 Sales");

    await user.clear(input);
    await user.type(input, "Q4 Forecast");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Q4 Forecast" })).toBeTruthy();
    expect(api.state.workbooks[0].name).toBe("Q4 Forecast");

    cleanup();
    renderApp();
    expect(await screen.findByRole("heading", { name: "Q4 Forecast" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "All workbooks" }));
    expect(await screen.findByRole("link", { name: "Q4 Forecast" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Q3 Sales" })).toBeNull();
  });

  it("trims the surrounding spaces before saving", async () => {
    const input = await openRenameDialog();
    await user.clear(input);
    await user.type(input, "  Q4 Forecast  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Q4 Forecast" })).toBeTruthy();
    expect(api.state.workbooks[0].name).toBe("Q4 Forecast");
  });

  it("rejects a blank name without saving or keeping a partial record", async () => {
    const input = await openRenameDialog();
    const requestsBefore = api.fetch.mock.calls.length;

    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Workbook name cannot be empty")).toBeTruthy();
    expect(api.fetch.mock.calls.length).toBe(requestsBefore);
    expect(api.state.workbooks[0].name).toBe("Q3 Sales");
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement).value).toBe("   ");
  });

  it("reports a failed save and keeps the original name", async () => {
    const input = await openRenameDialog();
    await user.clear(input);
    await user.type(input, "Q4 Forecast");
    api.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Storage unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Storage unavailable");
    expect(api.state.workbooks[0].name).toBe("Q3 Sales");
    expect(screen.getByRole("heading", { name: "Q3 Sales" })).toBeTruthy();
  });
});

describe("exporting the active worksheet as CSV", () => {
  let blobs: Blob[];
  let downloads: { fileName: string; href: string }[];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    blobs = [];
    downloads = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return `blob:mock-${blobs.length}`;
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => {} });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ fileName: this.download, href: this.getAttribute("href") ?? "" });
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  async function downloadedText(index: number): Promise<string> {
    const blobIndex = Number(downloads[index].href.split("-").pop()) - 1;
    return readFileText(blobs[blobIndex] as unknown as File);
  }

  it("downloads the active worksheet as .csv and keeps the editor state unchanged", async () => {
    await openSeedWorkbook();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "B2" }));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    const requestsBefore = api.fetch.mock.calls.length;
    const storedBefore = JSON.stringify(api.state.workbooks[0]);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName.endsWith(".csv")).toBe(true);
    expect(downloads[0].fileName).toBe("Q3 Sales - Sheet1.csv");
    expect(blobs[0].type).toContain("text/csv");
    expect(await downloadedText(0)).toBe("Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open\n");

    expect(api.fetch.mock.calls.length).toBe(requestsBefore);
    expect(JSON.stringify(api.state.workbooks[0])).toBe(storedBefore);
    expect(screen.getByText("Last updated: 2026-09-28 10:15")).toBeTruthy();
    expect(formulaBar.value).toBe("1200");
    expect(attributeOf(within(grid).getByRole("gridcell", { name: "B2" }), "aria-selected")).toBe("true");
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet1" }), "aria-selected")).toBe("true");
  });

  it("exports only the current active worksheet", async () => {
    api.state.workbooks[0].worksheets[1].cells = { A1: { value: 'Second, "sheet"' } };
    await openSeedWorkbook();
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(downloads[0].fileName).toBe("Q3 Sales - Sheet2.csv");
    expect(await downloadedText(0)).toBe('"Second, ""sheet"""\n');
    expect(attributeOf(screen.getByRole("tab", { name: "Sheet2" }), "aria-selected")).toBe("true");
    expect(api.state.workbooks[0].worksheets.length).toBe(2);
  });
});

describe("editing cells through the formula bar", () => {
  it("saves the typed value and reports a failed save without changing the stored value", async () => {
    await openSeedWorkbook();
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    await user.clear(formulaBar);
    await user.type(formulaBar, "West{Enter}");
    await waitFor(() => expect(api.state.workbooks[0].worksheets[0].cells.A1.value).toBe("West"));
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("West");

    api.state.failCellWrites = true;
    await user.clear(formulaBar);
    await user.type(formulaBar, "Broken{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("Storage unavailable");
    await waitFor(() => expect(formulaBar.value).toBe("West"));
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("West");
  });
});
