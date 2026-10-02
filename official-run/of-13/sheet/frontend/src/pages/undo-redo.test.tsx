import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import {
  OTHER_WORKBOOK_ID,
  SHEET1,
  WORKBOOK_ID,
  installFakeWorkbookApi,
  otherWorkbook,
  type FakeApiOptions,
} from "../test/fake-workbook-api";

const ORIGINAL_CELLS = {
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
};

async function openEditor(workbookId = WORKBOOK_ID) {
  window.location.hash = `#/workbooks/${workbookId}`;
  const view = render(<App />);
  await screen.findByRole("grid", { name: "Worksheet grid" });
  return view;
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function formulaBar() {
  return screen.getByLabelText("Formula bar") as HTMLInputElement;
}

function undoButton() {
  return screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
}

function redoButton() {
  return screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
}

function expectDisabled(button: HTMLButtonElement) {
  expect(button.disabled).toBe(true);
}

function expectEnabled(button: HTMLButtonElement) {
  expect(button.disabled).toBe(false);
}

function stateCalls(api: { calls: Array<{ method: string; path: string; body: unknown }> }) {
  return api.calls.filter((call) => call.method === "PUT" && call.path.endsWith("/state"));
}

function install(options: FakeApiOptions = {}) {
  return installFakeWorkbookApi(options);
}

/** Commits one value through the formula bar, then waits for the grid to show it. */
async function editCell(user: ReturnType<typeof userEvent.setup>, address: string, value: string) {
  await user.click(cell(address));
  await user.clear(formulaBar());
  await user.type(formulaBar(), value);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(cell(address).textContent).toBe(value));
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  window.location.hash = "#/";
});

describe("undo and redo of recent operations", () => {
  it("keeps both commands disabled until an operation is recorded", async () => {
    install();
    await openEditor();

    expectDisabled(undoButton());
    expectDisabled(redoButton());
  });

  it("undoes a cell edit, redoes it and keeps both results after reopening", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    await editCell(user, "B2", "999");
    await waitFor(() => expectEnabled(undoButton()));
    expectDisabled(redoButton());

    await user.click(undoButton());
    await waitFor(() => expect(cell("B2").textContent).toBe("1200"));
    expect(stateCalls(api).at(-1)?.body).toEqual({
      cells: ORIGINAL_CELLS,
      rowCount: null,
      columnCount: null,
      validations: [],
    });

    await user.click(redoButton());
    await waitFor(() => expect(cell("B2").textContent).toBe("999"));

    // Both the undone and the redone state are persisted: reopening shows the last one.
    window.location.hash = "#/";
    window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
    await waitFor(() => expect(cell("B2").textContent).toBe("999"));
    expect(api.workbooks[0].sheets[0].cells.B2).toBe("999");
  });

  it("undoes consecutive operations in reverse order", async () => {
    install();
    const user = userEvent.setup();
    await openEditor();

    await editCell(user, "D1", "first");
    await editCell(user, "D2", "second");

    await user.click(undoButton());
    await waitFor(() => expect(cell("D2").textContent).toBe(""));
    expect(cell("D1").textContent).toBe("first");

    await user.click(undoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe(""));
    expectDisabled(undoButton());

    await user.click(redoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe("first"));
    expect(cell("D2").textContent).toBe("");
    await user.click(redoButton());
    await waitFor(() => expect(cell("D2").textContent).toBe("second"));
    expectDisabled(redoButton());
  });

  it("disables Redo after a new modification and refuses Ctrl+Y for the old branch", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    await editCell(user, "D1", "first");
    await user.click(undoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe(""));

    await editCell(user, "D1", "second");
    expectDisabled(redoButton());
    const before = stateCalls(api).length;
    await user.keyboard("{Control>}y{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stateCalls(api).length).toBe(before);
    expect(cell("D1").textContent).toBe("second");
  });

  it("undoes and redoes with Ctrl+Z and Ctrl+Y", async () => {
    install();
    const user = userEvent.setup();
    await openEditor();

    await editCell(user, "D1", "typed");
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(cell("D1").textContent).toBe(""));

    await user.keyboard("{Control>}y{/Control}");
    await waitFor(() => expect(cell("D1").textContent).toBe("typed"));
  });

  it("undoes a pasted rectangle and a row structure change", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "South\t700" } });
    await waitFor(() => expect(cell("E1").textContent).toBe("700"));
    await user.click(undoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe(""));
    expect(cell("E1").textContent).toBe("");

    // Insert a row below row 1 through the row-number menu.
    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row below" }));
    await waitFor(() => expect(cell("A3").textContent).toBe("East"));
    expect(cell("A2").textContent).toBe("");

    await user.click(undoButton());
    await waitFor(() => expect(cell("A2").textContent).toBe("East"));
    expect(cell("A3").textContent).toBe("North");
    // Undoing the insertion also puts the grid size back.
    const restored = stateCalls(api).at(-1)?.body as { cells: Record<string, string>; rowCount: number | null };
    expect(restored.rowCount).toBeNull();
    expect(restored.cells.A2).toBe("East");
    expect(restored.cells.B3).toBe("800");
  });

  it("undoes only inside the workbook the operation was made in", async () => {
    const api = install({ workbooks: [otherWorkbook()] });
    const user = userEvent.setup();
    await openEditor();
    await editCell(user, "B2", "999");
    await user.click(undoButton());
    await waitFor(() => expect(cell("B2").textContent).toBe("1200"));

    expect(stateCalls(api).every((call) => call.path.includes(WORKBOOK_ID))).toBe(true);
    expect(api.workbooks[1].sheets[0].cells).toEqual({ A1: "Other" });

    // The other workbook has its own (empty) session history.
    window.location.hash = "#/";
    await screen.findByRole("link", { name: "Other book" });
    await user.click(screen.getByRole("link", { name: "Other book" }));
    await screen.findByRole("grid", { name: "Worksheet grid" });
    expect(cell("A1").textContent).toBe("Other");
    expectDisabled(undoButton());
    expectDisabled(redoButton());
    expect(api.workbooks[1].sheets[0].cells).toEqual({ A1: "Other" });
    expect(OTHER_WORKBOOK_ID).toBe(api.workbooks[1].id);
    expect(SHEET1).toBe(api.workbooks[0].sheets[0].id);
  });
});
