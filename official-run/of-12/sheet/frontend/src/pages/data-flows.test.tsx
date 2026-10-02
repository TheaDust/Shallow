import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFakeBackend } from "../test/fake-backend";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

type Harness = ReturnType<typeof installFakeBackend>;

async function openSeededEditor() {
  window.location.hash = "#/";
  const backend = installFakeBackend();
  const view = render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...backend, user, view };
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate });
}

/**
 * A gridcell found by its DOM attribute: a hidden row is out of the accessibility tree, so the
 * role query of `cell` cannot reach the records a filter hides.
 */
function cellElement(coordinate: string): HTMLElement {
  const element = grid().querySelector<HTMLElement>(`[data-cell-coordinate="${coordinate}"]`);
  if (!element) throw new Error(`No gridcell for ${coordinate}`);
  return element;
}

function cellText(coordinate: string) {
  return cellElement(coordinate).textContent;
}

/** The row a gridcell belongs to; `hidden` is how a filter removes a record from view. */
function rowHidden(coordinate: string) {
  return cellElement(coordinate).closest("[role='row']")?.hasAttribute("hidden") ?? false;
}

function selectRectangle(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseMove(cell(to));
  fireEvent.mouseUp(cell(to));
}

async function openDataMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  return screen.getByRole("menu");
}

async function chooseDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  const menu = await openDataMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name }));
}

function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  return screen.findByRole("grid", { name: "Worksheet grid" });
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
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return blobs;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("creating and clearing a filter view", () => {
  it("creates the filter for the selected region and exposes one filter button per header", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();

    selectRectangle("A1", "C4");
    await waitFor(() => expect(cell("C4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Create filter");

    for (const name of ["Filter Region", "Filter Sales", "Filter Status"]) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
    // Creating a filter never rewrites a record.
    expect(cellText("A2")).toBe("East");
    expect(cellText("C4")).toBe("Open");
    expect(rowHidden("A3")).toBe(false);
  });

  it("hides the rows a value list refuses, keeps them after refresh and restores them with Clear filter", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A1", "C4");
    await waitFor(() => expect(cell("C4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Create filter");

    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    // One checkbox per distinct source value, named by the displayed value.
    for (const value of ["East", "North", "South"]) {
      expect(within(dialog).getByRole("checkbox", { name: value })).toBeTruthy();
    }
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "East" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(rowHidden("A3")).toBe(true));
    expect(rowHidden("A2")).toBe(false);
    expect(rowHidden("A4")).toBe(true);
    // Hidden rows are neither deleted nor reordered: the values are still there.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cellText("A2")).toBe("East");
    expect(cellText("A3")).toBe("North");
    expect(cellText("A4")).toBe("South");

    // CSV export still includes the hidden rows.
    const blobs = captureDownload();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    const csv = await readBlob(blobs[0]);
    expect(csv).toBe("Region,Sales,Status\nEast,1200,Open\nNorth,800,Closed\nSouth,700,Open");

    await reopenEditor(backend);
    expect(rowHidden("A3")).toBe(true);
    expect(rowHidden("A2")).toBe(false);
    expect(rowHidden("A4")).toBe(true);

    const reopenedUser = userEvent.setup();
    await chooseDataCommand(reopenedUser, "Clear filter");
    await waitFor(() => expect(rowHidden("A3")).toBe(false));
    expect(rowHidden("A4")).toBe(false);
    expect(cellText("A3")).toBe("North");
    expect(cellText("B4")).toBe("700");
  });

  it("combines the conditions of different columns with AND", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A1", "C4");
    await waitFor(() => expect(cell("C4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Create filter");

    await user.click(await screen.findByRole("button", { name: "Filter Sales" }));
    let dialog = await screen.findByRole("dialog", { name: "Filter Sales" });
    await user.selectOptions(within(dialog).getByLabelText("Condition"), "greater-than");
    await user.type(within(dialog).getByLabelText("Value"), "750");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(rowHidden("A4")).toBe(true));
    expect(rowHidden("A2")).toBe(false);
    expect(rowHidden("A3")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.selectOptions(within(dialog).getByLabelText("Condition"), "text-contains");
    await user.type(within(dialog).getByLabelText("Value"), "Ea");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(rowHidden("A3")).toBe(true));
    expect(rowHidden("A4")).toBe(true);
    expect(rowHidden("A2")).toBe(false);

    // "Is empty" needs no value and keeps only the blank records of the column.
    await user.click(screen.getByRole("button", { name: "Filter Region" }));
    dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.selectOptions(within(dialog).getByLabelText("Condition"), "is-empty");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(rowHidden("A2")).toBe(true));
    expect(within(grid()).getByRole("button", { name: "Filter Region" })).toBeTruthy();
  });
});

describe("data validation", () => {
  it("applies a dropdown rule for the selected range and writes through the cell dropdown", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A2", "A4");
    await waitFor(() => expect(cell("A4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Data validation");

    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    expect((within(dialog).getByLabelText("Rule type") as HTMLSelectElement).value).toBe("dropdown");
    await user.type(within(dialog).getByLabelText("Allowed values"), "East, North");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const opener = await screen.findByRole("button", { name: "Open dropdown for A2" });
    expect(within(grid()).getByRole("button", { name: "Open dropdown for A4" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open dropdown for B2" })).toBeNull();

    await user.click(opener);
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["East", "North"]);
    await user.click(screen.getByRole("option", { name: "North" }));
    await waitFor(() => expect(cellText("A2")).toBe("North"));

    // An invalid value typed through the formula bar is refused and the cell keeps its value.
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.click(cell("A3"));
    await user.clear(formulaBar);
    await user.type(formulaBar, "West{Enter}");
    expect(await screen.findByText("Please select one of the following values: East, North")).toBeTruthy();
    expect(cellText("A3")).toBe("North");
    expect(formulaBar.value).toBe("North");

    // The rule stays active after a refresh.
    await reopenEditor(backend);
    expect(await screen.findByRole("button", { name: "Open dropdown for A3" })).toBeTruthy();
    expect(cellText("A3")).toBe("North");

    // Reopening the rule prefills the trimmed, comma-separated allowed values verbatim.
    await chooseDataCommand(user, "Data validation");
    const reopened = await screen.findByRole("dialog", { name: "Data validation" });
    expect((within(reopened).getByLabelText("Allowed values") as HTMLInputElement).value).toBe("East,North");
    await user.click(within(reopened).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("applies an inclusive number range, shows the 0-to-100 message and deletes the rule again", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("B2", "B4");
    await waitFor(() => expect(cell("B4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Data validation");

    let dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.selectOptions(within(dialog).getByLabelText("Rule type"), "number-range");
    await user.type(within(dialog).getByLabelText("Minimum"), "0");
    await user.type(within(dialog).getByLabelText("Maximum"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.click(cell("B3"));
    await user.clear(formulaBar);
    await user.type(formulaBar, "101{Enter}");
    expect(await screen.findByText("Please enter a number from 0 to 100")).toBeTruthy();
    expect(cellText("B3")).toBe("800");

    // Inclusive boundaries are accepted.
    await user.clear(formulaBar);
    await user.type(formulaBar, "100{Enter}");
    await waitFor(() => expect(cellText("B3")).toBe("100"));

    // Reopening the rule prefills it and offers Delete rule.
    await chooseDataCommand(user, "Data validation");
    dialog = await screen.findByRole("dialog", { name: "Data validation" });
    expect((within(dialog).getByLabelText("Rule type") as HTMLSelectElement).value).toBe("number-range");
    expect((within(dialog).getByLabelText("Minimum") as HTMLInputElement).value).toBe("0");
    expect((within(dialog).getByLabelText("Maximum") as HTMLInputElement).value).toBe("100");
    await user.click(within(dialog).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.clear(formulaBar);
    await user.type(formulaBar, "999{Enter}");
    await waitFor(() => expect(cellText("B3")).toBe("999"));
    expect(screen.queryByText("Please enter a number from 0 to 100")).toBeNull();
  });
});
