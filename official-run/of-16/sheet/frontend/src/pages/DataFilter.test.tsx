import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBackend, type FakeBackend } from "../test/fake-backend";
import { WorkbookEditorPage } from "./WorkbookEditorPage";

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

/** jsdom's Blob has no text() helper, so read the download through FileReader. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the downloaded CSV."));
    reader.readAsText(blob);
  });
}

describe("data filter", () => {
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

  /** Runs one `Data` menu command (its items use the ARIA menuitem role). */
  async function runDataCommand(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
    await user.click(screen.getByRole("button", { name: "Data" }));
    const menu = await screen.findByRole("menu", { name: "Data" });
    await user.click(within(menu).getByRole("menuitem", { name }));
  }

  async function createFilter(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await runDataCommand(user, "Create filter");
    await screen.findByRole("button", { name: "Filter Region" });
  }

  it("exposes the Data menu with its menuitem commands", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });

    await user.click(screen.getByRole("button", { name: "Data" }));
    const menu = await screen.findByRole("menu", { name: "Data" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Create filter",
      "Sort range",
      "Create pivot table",
      "Data validation",
      "Clear filter",
    ]);
    // No filter exists yet, so there is nothing to clear.
    expect((within(menu).getByRole("menuitem", { name: "Clear filter" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("filters one column by condition and keeps the hidden rows after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    await createFilter(user);

    // Every header of the filtered region provides its `Filter <header>` button.
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Sales" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Filter Sales" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Sales" });
    const condition = within(dialog).getByRole("combobox", { name: "Condition" });
    expect(within(condition).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "None",
      "Text contains",
      "Greater than",
      "Before",
      "Is empty",
      "Is not empty",
    ]);
    await user.selectOptions(condition, "greater-than");
    await user.type(within(dialog).getByRole("textbox", { name: "Value" }), "1000");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    // Only the row whose Sales value is greater than 1000 stays visible.
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());
    expect(screen.queryByRole("gridcell", { name: "A4" })).toBeNull();
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    // The hidden rows are not deleted or reordered: their values stay stored.
    expect(backend.workbooks[0].worksheets[0].cells.A3).toBe("North");
    expect(backend.workbooks[0].worksheets[0].cells.B4).toBe("700");
    expect(backend.workbooks[0].worksheets[0].filter).toEqual({
      range: "A1:C4",
      rules: [{ header: "Sales", type: "condition", condition: "greater-than", value: "1000" }],
    });

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A2" });
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());
    expect(screen.queryByRole("gridcell", { name: "A4" })).toBeNull();
  });

  it("filters by selected values, combines columns with AND and clears the filter", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    await createFilter(user);

    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    const regionDialog = await screen.findByRole("dialog", { name: "Filter Region" });
    // Checkboxes are generated from the distinct source values and start checked.
    expect(within(regionDialog).getAllByRole("checkbox")).toHaveLength(3);
    for (const name of ["East", "North", "South"]) {
      expect((within(regionDialog).getByRole("checkbox", { name }) as HTMLInputElement).checked).toBe(true);
    }
    await user.click(within(regionDialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(regionDialog).getByRole("checkbox", { name: "East" }));
    await user.click(within(regionDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());

    // A second column's condition is combined with AND.
    await user.click(screen.getByRole("button", { name: "Filter Sales" }));
    const salesDialog = await screen.findByRole("dialog", { name: "Filter Sales" });
    await user.selectOptions(within(salesDialog).getByRole("combobox", { name: "Condition" }), "greater-than");
    await user.type(within(salesDialog).getByRole("textbox", { name: "Value" }), "1500");
    await user.click(within(salesDialog).getByRole("button", { name: "Apply" }));

    // East is the only selected region, but its 1200 is not above 1500.
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A2" })).toBeNull());
    expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull();
    expect(screen.queryByRole("gridcell", { name: "B2" })).toBeNull();

    await runDataCommand(user, "Clear filter");
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East"));
    expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
    expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("South");
    expect(backend.workbooks[0].worksheets[0].cells.B4).toBe("700");
    expect(backend.workbooks[0].worksheets[0].filter).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();
  });

  it("keeps hidden rows in the CSV export without changing the view", async () => {
    const user = userEvent.setup();
    const download = stubDownload();
    try {
      render(<WorkbookEditorPage workbookId="q3-sales" />);
      await screen.findByRole("gridcell", { name: "A1" });
      await createFilter(user);

      await user.click(screen.getByRole("button", { name: "Filter Status" }));
      const dialog = await screen.findByRole("dialog", { name: "Filter Status" });
      await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
      await user.click(within(dialog).getByRole("checkbox", { name: "Open" }));
      await user.click(within(dialog).getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
      expect(screen.getByRole("gridcell", { name: "A4" }).textContent).toBe("South");

      await user.click(screen.getByRole("button", { name: "Export CSV" }));

      // The export reads the worksheet, so the hidden "Closed" row is included.
      expect(await readBlobText(download.blobs[0])).toBe(
        "Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open",
      );
      // The filter view itself is untouched by the export.
      expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull();
      expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
      expect(backend.workbooks[0].worksheets[0].filter).toEqual({
        range: "A1:C4",
        rules: [{ header: "Status", type: "values", values: ["Open"] }],
      });
    } finally {
      download.restore();
    }
  });

  it("reopens the value dialog with the stored rule selected", async () => {
    const user = userEvent.setup();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await screen.findByRole("gridcell", { name: "A1" });
    await createFilter(user);

    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "East" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("gridcell", { name: "A3" })).toBeNull());

    // Reopening the dialog shows the stored selection again.
    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    const reopened = await screen.findByRole("dialog", { name: "Filter Region" });
    expect((within(reopened).getByRole("checkbox", { name: "East" }) as HTMLInputElement).checked).toBe(true);
    expect((within(reopened).getByRole("checkbox", { name: "North" }) as HTMLInputElement).checked).toBe(false);
    expect((within(reopened).getByRole("checkbox", { name: "South" }) as HTMLInputElement).checked).toBe(false);
  });
});
