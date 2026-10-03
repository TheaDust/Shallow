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

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

/** jsdom's Blob has no `text()`, so read it through FileReader like the browser. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the blob"));
    reader.readAsText(blob, "utf-8");
  });
}

async function openImportDialog() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Import CSV" }));
  return user;
}

describe("CSV import", () => {
  it("offers an Import CSV dialog with a CSV file control and a Confirm import button", async () => {
    await openImportDialog();

    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    expect(within(dialog).getByLabelText("CSV file")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Confirm import" })).toBeTruthy();
  });

  it("imports a UTF-8 CSV file, names the workbook after the file and opens Sheet1", async () => {
    const user = await openImportDialog();

    const input = screen.getByLabelText("CSV file");
    await user.upload(
      input,
      csvFile("north-800.csv", 'Region,East,"North, Inc."\n1200,,"He said ""hi"""\n"multi\nline",中文,42\n'),
    );
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("heading", { level: 1, name: "north-800" })).not.toBeNull();
    const imported = backend.workbooks.find((entry) => entry.name === "north-800");
    expect(window.location.hash).toBe(`#/workbooks/${imported?.id}`);

    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab.getAttribute("aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).textContent).toBe("East");
    // The first row is ordinary data, not a header.
    expect(within(grid).getByRole("gridcell", { name: "C1" }).textContent).toBe("North, Inc.");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("1200");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("");
    expect(within(grid).getByRole("gridcell", { name: "C2" }).textContent).toBe('He said "hi"');
    expect(within(grid).getByRole("gridcell", { name: "A3" }).textContent).toBe("multi\nline");
    expect(within(grid).getByRole("gridcell", { name: "B3" }).textContent).toBe("中文");
    expect(within(grid).getByRole("gridcell", { name: "C3" }).textContent).toBe("42");

    // The seed workbook is untouched.
    const seed = backend.workbooks.find((entry) => entry.name === "Q3 Sales");
    expect(seed?.worksheets[0].cells.A1).toBe("Region");
  });

  it("keeps the imported rows after refreshing the editor entry", async () => {
    const user = await openImportDialog();
    await user.upload(screen.getByLabelText("CSV file"), csvFile("north-800.csv", "East,1200\nNorth,800\n"));
    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await screen.findByRole("heading", { level: 1, name: "north-800" });
    const importedId = backend.workbooks.find((entry) => entry.id !== "workbook-q3-sales")?.id;

    window.location.hash = "#/";
    expect(await screen.findByRole("link", { name: "north-800" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Q3 Sales" })).not.toBeNull();

    window.location.hash = `#/workbooks/${importedId}`;
    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("East");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).textContent).toBe("1200");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("North");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("800");
  });

  it("rejects invalid CSV beside the file control without creating a workbook", async () => {
    const user = await openImportDialog();

    await user.upload(screen.getByLabelText("CSV file"), csvFile("broken.csv", 'Region,East\n"unterminated\n'));
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByText("Invalid CSV file format. Import failed.")).not.toBeNull();
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeTruthy();
    expect(backend.workbooks).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "broken" })).toBeNull();
  });

  it("asks for a file when Confirm import is clicked with nothing selected", async () => {
    const user = await openImportDialog();

    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByText("Choose a CSV file to import.")).not.toBeNull();
    expect(backend.workbooks).toHaveLength(1);
    expect(window.location.hash).toBe("#/");
  });
});

describe("CSV export", () => {
  it("downloads the active worksheet as CSV without changing the editor state", async () => {
    backend.workbooks[0].worksheets[0].cells = {
      A1: "Region",
      B1: 'North, "East"',
      C1: "line\nbreak",
      A2: "1200",
      C2: "800",
    };
    window.location.hash = "#/workbooks/workbook-q3-sales";

    const created: Blob[] = [];
    const downloads: { download: string; href: string }[] = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob);
      return "blob:csv";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ download: this.download, href: this.href });
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    await user.click(screen.getByRole("gridcell", { name: "B1" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
        'North, "East"',
      ),
    );

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].download.endsWith(".csv")).toBe(true);
    expect(downloads[0].download).toContain("Sheet1");
    expect(await readBlobText(created[0])).toBe('Region,"North, ""East""","line\nbreak"\n1200,,800');

    // Export is read-only: the active worksheet, selection and formula bar are unchanged.
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe(
      'North, "East"',
    );
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(backend.workbooks[0].worksheets[0].cells).toEqual({
      A1: "Region",
      B1: 'North, "East"',
      C1: "line\nbreak",
      A2: "1200",
      C2: "800",
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
