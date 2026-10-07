import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "./App";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID, installFakeApi, type FakeApi } from "./test/fake-api";

let api: FakeApi | undefined;

beforeEach(() => {
  window.location.hash = `#/workbooks/${SEED_WORKBOOK_ID}`;
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = undefined;
});

function grid() {
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function sheet() {
  return api!.workbooks[0].worksheets.find((worksheet) => worksheet.id === SEED_WORKSHEET_ID)!;
}

async function openDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

/** Creates the filter view on the seeded A1:C4 table. */
async function createFilter(user: ReturnType<typeof userEvent.setup>) {
  await openDataCommand(user, "Create filter");
  await screen.findByRole("button", { name: "Filter Region" });
}

/** Filters one column by picking source values in its dialog. */
async function filterByValues(
  user: ReturnType<typeof userEvent.setup>,
  header: string,
  values: string[],
) {
  await user.click(screen.getByRole("button", { name: `Filter ${header}` }));
  const dialog = await screen.findByRole("dialog", { name: `Filter ${header}` });
  for (const value of values) {
    await user.click(within(dialog).getByRole("checkbox", { name: value }));
  }
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Filter ${header}` })).toBeNull());
}

function cellText(name: string): string | null {
  return screen.queryByRole("gridcell", { name })?.textContent ?? null;
}

/** The record text the grid exposes for one row of values, or `null`. */
function recordText(record: string): string | null {
  return screen.queryByText(record, { exact: true })?.textContent ?? null;
}

test("Create filter adds one header button per column and hides non-matching records", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await createFilter(user);
  expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Filter Sales" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Filter Region" }));
  const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
  // Checkboxes come from the distinct source values of that column.
  expect(within(dialog).getByRole("checkbox", { name: "East" })).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "North" })).toBeTruthy();
  expect(within(dialog).getByRole("checkbox", { name: "South" })).toBeTruthy();
  await user.click(within(dialog).getByRole("checkbox", { name: "East" }));
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter Region" })).toBeNull());

  // Only the matching record stays visible; the whole row is hidden, not edited.
  expect(cellText("A2")).toBe("East");
  expect(cellText("A3")).toBeNull();
  expect(cellText("A4")).toBeNull();
  expect(cellText("B3")).toBeNull();
  expect(sheet().cells.A3).toBe("North");
  // The visible record stays readable as one text, hidden rows take theirs away.
  expect(recordText("East/1200/Open")).toBe("East/1200/Open");
  expect(recordText("North/800/Closed")).toBeNull();
  expect(recordText("South/700/Open")).toBeNull();
  // Rows outside the filtered range are not affected.
  expect(screen.getByRole("rowheader", { name: "8" })).toBeTruthy();
  expect(sheet().filter).toEqual({
    range: "A1:C4",
    columns: [
      { column: 1, header: "Region", mode: "values", values: ["East"] },
      { column: 2, header: "Sales", mode: "values", values: [] },
      { column: 3, header: "Status", mode: "values", values: [] },
    ],
  });
});

test("conditions on different columns combine with AND and Clear filter restores every record", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createFilter(user);

  await user.click(screen.getByRole("button", { name: "Filter Sales" }));
  const sales = await screen.findByRole("dialog", { name: "Filter Sales" });
  await user.selectOptions(within(sales).getByLabelText("Condition"), "Greater than");
  await user.type(within(sales).getByLabelText("Value"), "700");
  await user.click(within(sales).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter Sales" })).toBeNull());
  expect(cellText("A4")).toBeNull(); // South 700 is not greater than 700
  expect(cellText("A3")).toBe("North");

  await user.click(screen.getByRole("button", { name: "Filter Region" }));
  const region = await screen.findByRole("dialog", { name: "Filter Region" });
  await user.selectOptions(within(region).getByLabelText("Condition"), "Text contains");
  await user.type(within(region).getByLabelText("Value"), "nor");
  await user.click(within(region).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter Region" })).toBeNull());

  // Both columns must match: only North (800 > 700) survives.
  expect(cellText("A2")).toBeNull();
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBeNull();
  expect(sheet().cells.A2).toBe("East");

  await openDataCommand(user, "Clear filter");
  await waitFor(() => expect(cellText("A2")).toBe("East"));
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBe("South");
  expect(recordText("North/800/Closed")).toBe("North/800/Closed");
  expect(recordText("South/700/Open")).toBe("South/700/Open");
  expect(sheet().filter).toBeUndefined();
});

test("an empty condition needs no value and a condition without a value is reported in the dialog", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createFilter(user);

  await user.click(screen.getByRole("button", { name: "Filter Status" }));
  const status = await screen.findByRole("dialog", { name: "Filter Status" });
  await user.selectOptions(within(status).getByLabelText("Condition"), "Before");
  await user.click(within(status).getByRole("button", { name: "Apply" }));
  expect((await within(status).findByRole("alert")).textContent).toBe("Please enter a value for the condition");
  expect(sheet().filter?.columns.some((column) => column.mode === "condition")).toBe(false);

  await user.selectOptions(within(status).getByLabelText("Condition"), "Is empty");
  await user.click(within(status).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter Status" })).toBeNull());
  // Every seeded record has a status, so the whole data area is hidden.
  expect(cellText("A2")).toBeNull();
  expect(cellText("A3")).toBeNull();
  expect(cellText("A4")).toBeNull();
  expect(sheet().cells.A2).toBe("East");
});

test("the filter view and its visible rows persist after a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createFilter(user);
  await filterByValues(user, "Region", ["North"]);

  expect(cellText("A2")).toBeNull();
  expect(cellText("A3")).toBe("North");

  cleanup();
  render(<App />);
  await grid();
  expect(cellText("A2")).toBeNull();
  expect(cellText("A3")).toBe("North");
  expect(cellText("A4")).toBeNull();

  // Reopening the dialog prefills the saved selection; clearing it shows all rows.
  await user.click(screen.getByRole("button", { name: "Filter Region" }));
  const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
  expect((within(dialog).getByRole("checkbox", { name: "North" }) as HTMLInputElement).checked).toBe(true);
  expect((within(dialog).getByRole("checkbox", { name: "East" }) as HTMLInputElement).checked).toBe(false);
  await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
  await user.click(within(dialog).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter Region" })).toBeNull());
  expect(cellText("A2")).toBe("East");
  expect(cellText("A4")).toBe("South");
});

test("exporting CSV still contains the hidden rows of the filtered range", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();
  await createFilter(user);
  await filterByValues(user, "Region", ["East"]);

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
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blobs[0]);
    });
    expect(text).toBe(
      ["Region,Sales,Status", "East,1200,Open", "North,800,Closed", "South,700,Open"].join("\n"),
    );
    // The filtered view and the grid values are unchanged by the export.
    expect(cellText("A2")).toBe("East");
    expect(cellText("A3")).toBeNull();
    expect(sheet().cells.A3).toBe("North");
  } finally {
    click.mockRestore();
    Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke });
  }
});
