import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFakeBackend, seededWorkbook } from "../test/fake-backend";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  window.location.hash = "#/";
});

function renderHome() {
  window.location.hash = "#/";
  const backend = installFakeBackend();
  render(<App />);
  return backend;
}

async function openImportDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Import CSV" }));
  const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
  return { user, dialog, input: within(dialog).getByLabelText("CSV file") as HTMLInputElement };
}

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

describe("import CSV dialog", () => {
  it("opens from the home page with a CSV file control and a Confirm import button", async () => {
    renderHome();
    const { input, dialog } = await openImportDialog();
    expect(input.getAttribute("type")).toBe("file");
    expect(within(dialog).getByRole("button", { name: "Confirm import" })).toBeTruthy();
  });

  it("imports a CSV file as a new workbook, opens Sheet1 and keeps the rows after refresh", async () => {
    const backend = renderHome();
    const { user, input, dialog } = await openImportDialog();
    const content = 'Region,East\n"North, South",1200\n800,华东\n';
    await user.upload(input, csvFile("q3-copy.csv", content));
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    await screen.findByRole("heading", { level: 1, name: "q3-copy" });
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).textContent).toBe("East");
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("North, South");
    expect(within(grid).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
    expect(within(grid).getByRole("gridcell", { name: "A3" }).textContent).toBe("800");
    expect(within(grid).getByRole("gridcell", { name: "B3" }).textContent).toBe("华东");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");

    const editorHash = window.location.hash;
    expect(editorHash.startsWith("#/workbooks/")).toBe(true);

    cleanup();
    backend.install();
    window.location.hash = editorHash;
    render(<App />);
    const refreshed = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(refreshed).getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect(within(refreshed).getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");

    await user.click(screen.getByRole("link", { name: "Back to workbooks" }));
    const link = await screen.findByRole("link", { name: "q3-copy" });
    expect(link).toBeTruthy();
  });

  it("rejects an invalid CSV file without creating a workbook", async () => {
    const backend = renderHome();
    const { user, input, dialog } = await openImportDialog();
    await user.upload(input, csvFile("broken.csv", 'Region,"East\n1200,North\n'));
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect(await within(dialog).findByText("Invalid CSV file format. Import failed.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Workbooks" })).toBeTruthy();
    expect(backend.state.workbooks.map((workbook) => workbook.name)).toEqual(["Q3 Sales"]);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Q3 Sales"]);
  });
});

describe("export CSV", () => {
  /** jsdom's Blob has no `text()`, so read the generated artifact through FileReader. */
  function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }

  function captureDownload() {
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:mock";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    return { blobs, click };
  }

  it("downloads the active worksheet while leaving the editor state untouched", async () => {
    window.location.hash = "#/workbooks/wb-q3-sales";
    const workbook = seededWorkbook();
    workbook.worksheets[0].cells = {
      A1: "Region", B1: "Qty", A2: "North, South", B2: "1200", A3: "line1\nline2", C3: 'say "hi"',
    };
    const backend = installFakeBackend([workbook]);
    render(<App />);
    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    const { blobs, click } = captureDownload();
    const requestsBefore = backend.requests.length;

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download.endsWith(".csv")).toBe(true);
    const text = await readBlob(blobs[0]);
    expect(text).toBe('Region,Qty,\n"North, South",1200,\n"line1\nline2",,"say ""hi"""');

    // Export reads the current worksheet only: no request, no changed cell or selection.
    expect(backend.requests.length).toBe(requestsBefore);
    expect(within(grid).getByRole("gridcell", { name: "A2" }).textContent).toBe("North, South");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("Region");
  });
});
