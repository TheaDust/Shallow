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
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...backend, user };
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate });
}

function cellText(coordinate: string) {
  const element = grid().querySelector(`[data-cell-coordinate="${coordinate}"]`);
  return element?.textContent ?? "";
}

/** One column of the seeded range, read by the coordinates the grid shows it at. */
function columnValues(letter: string) {
  return ["2", "3", "4"].map((row) => cellText(`${letter}${row}`));
}

function selectRectangle(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseMove(cell(to));
  fireEvent.mouseUp(cell(to));
}

async function chooseDataCommand(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "Data" }));
  const menu = screen.getByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name }));
}

function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

describe("Sort range", () => {
  it("offers the selected range's headers and re-orders the records by the chosen column", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    // A cell outside the sorted range must keep its value.
    await user.click(cell("E1"));
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
    await user.type(formulaBar, "Keep{Enter}");
    await waitFor(() => expect(cellText("E1")).toBe("Keep"));

    selectRectangle("A1", "C4");
    await waitFor(() => expect(cell("C4").getAttribute("aria-selected")).toBe("true"));

    await chooseDataCommand(user, "Sort range");
    const dialog = await screen.findByRole("dialog", { name: "Sort range" });

    // `Sort by` options are named by the header text of the selected range.
    const sortBy = within(dialog).getByLabelText("Sort by") as HTMLSelectElement;
    expect(Array.from(sortBy.options).map((option) => option.textContent)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);
    const order = within(dialog).getByLabelText("Order") as HTMLSelectElement;
    expect(Array.from(order.options).map((option) => option.textContent)).toEqual(["Ascending", "Descending"]);
    const headerRow = within(dialog).getByRole("checkbox", { name: "Data has header row" });
    expect((headerRow as HTMLInputElement).checked).toBe(true);

    await user.selectOptions(sortBy, "B");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The header row stays out of the sort and the records move together, whole rows at a time.
    expect(cellText("A1")).toBe("Region");
    expect(columnValues("A")).toEqual(["South", "North", "East"]);
    expect(columnValues("B")).toEqual(["700", "800", "1200"]);
    expect(columnValues("C")).toEqual(["Open", "Closed", "Open"]);
    expect(cellText("E1")).toBe("Keep");

    // The order survives a refresh of the editor.
    await reopenEditor(backend);
    expect(columnValues("A")).toEqual(["South", "North", "East"]);
    expect(cellText("B4")).toBe("1200");
  });

  it("sorts descending, keeps equal keys in their original order and shows a failure without moving rows", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A1", "C4");
    await waitFor(() => expect(cell("C4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Sort range");

    let dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.selectOptions(within(dialog).getByLabelText("Sort by"), "C");
    await user.selectOptions(within(dialog).getByLabelText("Order"), "descending");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Descending on Status: the two `Open` records keep their relative order.
    expect(columnValues("C")).toEqual(["Open", "Open", "Closed"]);
    expect(columnValues("A")).toEqual(["East", "South", "North"]);

    // A single-cell selection cannot be sorted: the dialog reports the failure and the grid keeps
    // its current order.
    await user.click(cell("A1"));
    await chooseDataCommand(user, "Sort range");
    dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    expect(await within(dialog).findByText("Select a range with at least two rows to sort")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Sort range" })).toBeTruthy();
    expect(columnValues("A")).toEqual(["East", "South", "North"]);
    expect(grid().querySelector('[data-cell-coordinate="A2"]')?.textContent).toBe("East");
  });

  it("keeps a filter and its hidden rows while sorting the same range", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A1", "C4");
    await waitFor(() => expect(cell("C4").getAttribute("aria-selected")).toBe("true"));
    await chooseDataCommand(user, "Create filter");
    await user.click(await screen.findByRole("button", { name: "Filter Region" }));
    let dialog = await screen.findByRole("dialog", { name: "Filter Region" });
    await user.click(within(dialog).getByRole("button", { name: "Clear selection" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "East" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    const rowHidden = (coordinate: string) =>
      grid().querySelector(`[data-cell-coordinate="${coordinate}"]`)?.closest("[role='row']")?.hasAttribute("hidden") ?? false;
    await waitFor(() => expect(rowHidden("A3")).toBe(true));

    await chooseDataCommand(user, "Sort range");
    dialog = await screen.findByRole("dialog", { name: "Sort range" });
    await user.selectOptions(within(dialog).getByLabelText("Sort by"), "B");
    await user.click(within(dialog).getByRole("button", { name: "Sort" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Sorting moves hidden records with their range; the filter still hides the same records.
    expect(columnValues("A")).toEqual(["South", "North", "East"]);
    expect(rowHidden("A2")).toBe(true);
    expect(rowHidden("A3")).toBe(true);
    expect(rowHidden("A4")).toBe(false);
    expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();
  });
});
