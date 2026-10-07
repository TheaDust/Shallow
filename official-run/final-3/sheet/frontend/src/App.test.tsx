import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";
import { worksheetToCsv } from "./domain/csv";
import { formatLastUpdated } from "./domain/grid";
import { SEED_UPDATED_AT, SEED_WORKBOOK_ID, SEED_WORKSHEET_ID, installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

test("the home page lists seeded workbooks with a last-updated line and a link named by the workbook", async () => {
  api = installFakeApi();
  render(<App />);

  const link = await screen.findByRole("link", { name: "Q3 Sales" });
  expect(link.getAttribute("href")).toBe(`#/workbooks/${SEED_WORKBOOK_ID}`);
  expect(link.textContent).toBe("Q3 Sales");
  await screen.findByText(formatLastUpdated(SEED_UPDATED_AT));
});

test("clicking the workbook link opens the editor for the same workbook state", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));

  expect(window.location.hash).toBe(`#/workbooks/${SEED_WORKBOOK_ID}`);
  const table = await grid();
  expect(table.getAttribute("aria-multiselectable")).toBe("true");

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");
  await screen.findByText(formatLastUpdated(SEED_UPDATED_AT));

  const tab = screen.getByRole("tab", { name: "Sheet1" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("false");

  const a1 = screen.getByRole("gridcell", { name: "A1" });
  expect(a1.textContent).toBe("Region");
  expect(a1.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe("false");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("Region");
});

test("the editor entry is directly accessible and keeps the same workbook after refresh", async () => {
  api = installFakeApi();
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;

  const view = render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
  expect(await screen.findByText(formatLastUpdated(SEED_UPDATED_AT))).toBeTruthy();
});

test("creating a blank workbook opens a single blank Sheet1 with A1 selected", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
  expect(window.location.hash).toBe("#/workbooks/new");

  const create = await screen.findByRole("button", { name: "Create" });
  await user.click(create);

  await grid();
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1"]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  const a1 = screen.getByRole("gridcell", { name: "A1" });
  expect(a1.getAttribute("aria-selected")).toBe("true");
  expect(a1.textContent).toBe("");

  await user.click(screen.getByRole("link", { name: "Home" }));
  expect(window.location.hash).toBe("#/");
  const created = await screen.findByRole("link", { name: "Untitled workbook" });
  expect(created.getAttribute("href")).toBe("#/workbooks/wb-new-1");
});

test("a created blank workbook is listed, reopens unchanged and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);

  await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
  await user.click(await screen.findByRole("button", { name: "Create" }));
  await grid();
  expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");

  await user.click(screen.getByRole("link", { name: "Home" }));
  const created = await screen.findByRole("link", { name: "Untitled workbook" });
  expect(created.getAttribute("href")).toBe("#/workbooks/wb-new-1");

  await user.click(created);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Untitled workbook");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1"]);
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");

  view.unmount();
  render(<App />);
  await grid();
  expect(window.location.hash).toBe("#/workbooks/wb-new-1");
  expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
});

test("editing the formula bar saves the cell and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
  const view = render(<App />);
  await grid();

  await user.click(screen.getByRole("gridcell", { name: "A2" }));
  const bar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
  expect(bar.readOnly).toBe(false);
  await user.clear(bar);
  await user.type(bar, "West{Enter}");

  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("West");
  expect(bar.value).toBe("West");
  await waitFor(() => expect(api!.workbooks[0].worksheets[0].cells.A2).toBe("West"));

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("West");
  await user.click(screen.getByRole("gridcell", { name: "A2" }));
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("West");
});

test("a failed cell save reports an error and keeps the last successful value", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("PATCH", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}/cells`);
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
  render(<App />);
  await grid();

  await user.click(screen.getByRole("gridcell", { name: "A2" }));
  const bar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
  await user.clear(bar);
  await user.keyboard("{Enter}");

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  await waitFor(() => expect(bar.value).toBe("East"));
  expect(api.workbooks[0].worksheets[0].cells.A2).toBe("East");
});

test("a failed creation shows an error and leaves no workbook record", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("POST", "/api/workbooks");
  render(<App />);

  await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
  await user.click(await screen.findByRole("button", { name: "Create" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(window.location.hash).toBe("#/workbooks/new");
  expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "Home" }));
  expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Untitled workbook" })).toBeNull();
});

test("renaming a workbook updates the editor title and the home page link", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
  render(<App />);
  await grid();

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  const input = within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  expect(input.value).toBe("Q3 Sales");

  await user.clear(input);
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Workbook name cannot be empty");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");

  await user.type(input, "  Q4 Sales  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename workbook" })).toBeNull());
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q4 Sales");

  await user.click(screen.getByRole("link", { name: "Home" }));
  const renamed = await screen.findByRole("link", { name: "Q4 Sales" });
  expect(renamed.getAttribute("href")).toBe(`#/workbooks/${SEED_WORKBOOK_ID}`);
});

test("a failed rename reports an error and keeps the original name after refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("PATCH", `/api/workbooks/${SEED_WORKBOOK_ID}`);
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
  const view = render(<App />);
  await grid();

  await user.click(screen.getByRole("button", { name: "Rename workbook" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename workbook" });
  const input = within(dialog).getByRole("textbox", { name: "Workbook name" }) as HTMLInputElement;
  await user.clear(input);
  await user.type(input, "Q4 Sales");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Server error");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q3 Sales");
  expect(api.workbooks[0].name).toBe("Q3 Sales");
});

test("clicking a grid cell moves the selected cell and updates the formula bar", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
  render(<App />);
  await grid();

  await user.click(screen.getByRole("gridcell", { name: "B2" }));
  expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("false");
  expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("1200");
});

test("an unknown route reports that the page is not found", async () => {
  api = installFakeApi();
  window.location.hash = "#/nope";
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
});

test("importing a UTF-8 CSV opens Sheet1 with the complete imported data", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  await user.click(await screen.findByRole("button", { name: "Import CSV" }));
  const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
  const fileInput = within(dialog).getByLabelText("CSV file") as HTMLInputElement;
  const file = new File(["地区,销量\n华东,1200\nNorth,800"], "Q4 Sales.csv", { type: "text/csv" });
  await user.upload(fileInput, file);
  await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

  await grid();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Q4 Sales");
  const tab = screen.getByRole("tab", { name: "Sheet1" });
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("地区");
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1200");
  expect(screen.getByRole("gridcell", { name: "A3" }).textContent).toBe("North");
});

test("an invalid CSV is rejected beside the file control and no workbook is created", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);

  await user.click(await screen.findByRole("button", { name: "Import CSV" }));
  const dialog = await screen.findByRole("dialog", { name: "Import CSV" });
  const fileInput = within(dialog).getByLabelText("CSV file") as HTMLInputElement;
  await user.upload(fileInput, new File(['a,"broken'], "broken.csv", { type: "text/csv" }));
  await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Invalid CSV file format. Import failed.");
  expect(window.location.hash).toBe("#/");

  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "broken" })).toBeNull();
});

test("exporting writes the edited text, escapes it and uses calculated formula results", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;

  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:test";
  });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });

  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  try {
    render(<App />);
    await grid();

    await user.click(screen.getByRole("gridcell", { name: "A2" }));
    const bar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.clear(bar);
    await user.type(bar, 'East, "North"{Enter}');
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe('East, "North"');

    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    await user.clear(bar);
    await user.type(bar, "=1+2{Enter}");
    expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("3");
    expect(bar.value).toBe("=1+2");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(await readBlob(blobs[0])).toBe(
      [
        "Region,Sales,Status",
        '"East, ""North""",3,Open',
        "North,800,Closed",
        "South,700,Open",
      ].join("\n"),
    );

    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe('East, "North"');
    expect(bar.value).toBe("=1+2");
  } finally {
    click.mockRestore();
    Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke });
  }
});

test("exporting downloads the active worksheet as CSV without changing the view", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;

  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:test";
  });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });

  try {
    render(<App />);
    await grid();

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blobs[0]);
    });
    expect(text).toBe(
      worksheetToCsv({
        cells: {
          A1: "Region", B1: "Sales", C1: "Status",
          A2: "East", B2: "1200", C2: "Open",
          A3: "North", B3: "800", C3: "Closed",
          A4: "South", B4: "700", C4: "Open",
        },
      }),
    );

    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("Region");
    expect((screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value).toBe("Region");
  } finally {
    click.mockRestore();
    Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke });
  }
});
