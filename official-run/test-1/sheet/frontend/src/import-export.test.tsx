import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { installApiMock } from "./test/apiMock";

const mock = installApiMock();

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
  mock.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openImportDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Import CSV" }));
  const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
  return dialog;
}

async function uploadCsv(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>, fileName: string, content: string) {
  const input = within(dialog).getByLabelText("CSV file");
  const file = new File([content], fileName, { type: "text/csv" });
  await user.upload(input, file);
  return input;
}

describe("REQ-1-3-1 import CSV to create a workbook", () => {
  it("home page provides an Import CSV button that opens the Import CSV dialog", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
    expect(within(dialog).getByLabelText("CSV file")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm import" })).toBeInTheDocument();
  });

  it("importing a valid CSV creates a workbook named after the file and opens Sheet1 with the complete data", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openImportDialog(user);
    await uploadCsv(
      dialog,
      user,
      "sales data.csv",
      'Region,East,1200\nNorth,800,West\n地区,华东,"a,b"',
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    const heading = await screen.findByRole("heading", { level: 1, name: "sales data" });
    expect(heading).toBeInTheDocument();
    const tab = screen.getByRole("tab", { name: "Sheet1" });
    expect(tab).toHaveAttribute("aria-selected", "true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const expected: Record<string, string> = {
      A1: "Region",
      B1: "East",
      C1: "1200",
      A2: "North",
      B2: "800",
      C2: "West",
      A3: "地区",
      B3: "华东",
      C3: "a,b",
    };
    for (const [coord, value] of Object.entries(expected)) {
      expect(within(grid).getByRole("gridcell", { name: coord })).toHaveTextContent(value);
    }
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Region");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the imported workbook keeps its grid content after refresh and appears on the home page", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    const dialog = await openImportDialog(user);
    await uploadCsv(dialog, user, "data.csv", "a,,c\nx,y,z");
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));
    await screen.findByRole("heading", { level: 1, name: "data" });

    // refresh: same editor URL restores the same imported state
    unmount();
    renderApp();
    const heading = await screen.findByRole("heading", { level: 1, name: "data" });
    expect(heading).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveTextContent("a");
    expect(within(grid).getByRole("gridcell", { name: "B1" })).toHaveTextContent("");
    expect(within(grid).getByRole("gridcell", { name: "C1" })).toHaveTextContent("c");
    expect(within(grid).getByRole("gridcell", { name: "A2" })).toHaveTextContent("x");
    expect(within(grid).getByRole("gridcell", { name: "C2" })).toHaveTextContent("z");

    // the home page shows the imported record
    window.location.hash = "#/";
    expect(await screen.findByRole("link", { name: "data" })).toBeInTheDocument();
  });

  it("invalid CSV is rejected with the exact message and leaves no partial record", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openImportDialog(user);
    await uploadCsv(dialog, user, "broken.csv", 'Region,"East\nNorth,1200');
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid CSV file format. Import failed.",
    );
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "broken" })).not.toBeInTheDocument();
    // seeded workbook remains untouched
    expect(mock.workbooks()).toHaveLength(1);
  });

  it("a field with an escaped quote imports and displays the original text", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openImportDialog(user);
    await uploadCsv(dialog, user, "quotes.csv", 'name,note\nAlice,"say ""hi"""');
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));
    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A2" })).toHaveTextContent("Alice");
    expect(within(grid).getByRole("gridcell", { name: "B2" })).toHaveTextContent('say "hi"');
  });
});

describe("REQ-1-3-2 export the current worksheet as CSV", () => {
  function readBlobText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("failed to read blob"));
      reader.readAsText(blob, "utf-8");
    });
  }

  function stubDownload() {
    const downloads: { fileName: string; text: string }[] = [];
    const blobs: Blob[] = [];
    const urlObj = URL as unknown as {
      createObjectURL?: (blob: Blob | MediaSource) => string;
      revokeObjectURL?: (url: string) => void;
    };
    const originalCreate = urlObj.createObjectURL;
    const originalRevoke = urlObj.revokeObjectURL;
    urlObj.createObjectURL = (blob) => {
      blobs.push(blob as Blob);
      return "blob:mock";
    };
    urlObj.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      const blob = blobs[blobs.length - 1];
      downloads.push({ fileName: this.download, text: "" });
      void readBlobText(blob).then((text) => {
        downloads[downloads.length - 1].text = text;
      });
    });
    afterEach(() => {
      if (originalCreate) urlObj.createObjectURL = originalCreate;
      else delete urlObj.createObjectURL;
      if (originalRevoke) urlObj.revokeObjectURL = originalRevoke;
      else delete urlObj.revokeObjectURL;
    });
    return downloads;
  }

  it("Export CSV starts a download whose filename ends with .csv and whose text is the active worksheet", async () => {
    const user = userEvent.setup();
    const downloads = stubDownload();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toMatch(/\.csv$/);
    // seeded Sheet1 has Item/Qty and Pen/4 in A1:B2
    await vi.waitFor(() => expect(downloads[0].text).toBe("Item,Qty\nPen,4"));
  });

  it("export does not change grid values, formula bar or the active worksheet", async () => {
    const user = userEvent.setup();
    stubDownload();
    renderApp();
    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(screen.getByRole("heading", { level: 1, name: "Q3 Sales" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet1" })).toHaveAttribute("aria-selected", "true");
    expect(within(grid).getByRole("gridcell", { name: "A1" })).toHaveTextContent("Item");
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("Item");
  });

  it("exporting an imported sheet preserves empty cells and escapes special text", async () => {
    const user = userEvent.setup();
    const downloads = stubDownload();
    renderApp();
    const dialog = await openImportDialog(user);
    await uploadCsv(dialog, user, "report.csv", 'Region,East\nNorth,,800\nNote,"say ""hi"", now"');
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));
    await screen.findByRole("heading", { level: 1, name: "report" });

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toBe("report.csv");
    await vi.waitFor(() =>
      expect(downloads[0].text).toBe('Region,East,\nNorth,,800\nNote,"say ""hi"", now",'),
    );
  });
});
