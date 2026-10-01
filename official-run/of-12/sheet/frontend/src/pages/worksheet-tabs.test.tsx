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

function renderAt(hash: string) {
  window.location.hash = hash;
  const backend = installFakeBackend();
  render(<App />);
  return backend;
}

async function openSeededEditor() {
  const backend = renderAt("#/");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...backend, user };
}

/** Reopens the editor URL of the same workbook from the persisted state. */
async function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return userEvent.setup();
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cellValue(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate }).textContent;
}

function formulaBar() {
  return screen.getByRole("textbox", { name: "Formula bar" });
}

function tabNames() {
  return screen.getAllByRole("tab").map((tab) => tab.textContent);
}

function selectCell(coordinate: string) {
  const target = within(grid()).getByRole("gridcell", { name: coordinate });
  fireEvent.mouseDown(target, { button: 0 });
  fireEvent.mouseUp(target);
  return target;
}

async function openWorksheetMenu(user: ReturnType<typeof userEvent.setup>, worksheetName: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${worksheetName}` }));
  return screen.getByRole("menu", { name: `Worksheet options for ${worksheetName}` });
}

describe("Add worksheet", () => {
  it("appends a blank tab named after the first unused SheetN, makes it active and keeps it after reopening", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    const created = await screen.findByRole("tab", { name: "Sheet3" });
    await waitFor(() => expect(created.getAttribute("aria-selected")).toBe("true"));
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("false");
    // The new worksheet is blank and starts on A1.
    expect(cellValue("A1")).toBe("");
    expect(formulaBar()).toHaveProperty("value", "");
    expect(within(grid()).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");

    // The existing worksheets keep their data.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A1")).toBe("Region"));
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("B2")).toBe("1200");
    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(cellValue("A1")).toBe(""));

    const reopened = await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    await reopened.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A3")).toBe("North"));
    expect(cellValue("B3")).toBe("800");
  });

  it("reports a failed addition without changing the existing tabs", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    backend.failNextRequest((method, path) => method === "POST" && path.endsWith("/worksheets"), {
      error: "Worksheet could not be added",
    });

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));

    expect(await screen.findByText("Worksheet could not be added")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(cellValue("A2")).toBe("East");

    await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });

  it("creates Sheet2 when the workbook only has Sheet1", async () => {
    window.location.hash = "#/";
    installFakeBackend();
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    await screen.findByRole("heading", { level: 1, name: "New workbook" });
    await user.clear(screen.getByRole("textbox", { name: "Workbook name" }));
    await user.type(screen.getByRole("textbox", { name: "Workbook name" }), "Budget");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("heading", { level: 1, name: "Budget" });
    expect(tabNames()).toEqual(["Sheet1"]);
    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    const created = await screen.findByRole("tab", { name: "Sheet2" });
    expect(created.getAttribute("aria-selected")).toBe("true");
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });

  it("reuses a freed SheetN name for the next added worksheet", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const menu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    await user.clear(input);
    await user.type(input, "Notes");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toEqual(["Sheet1", "Notes"]);

    await user.click(screen.getByRole("button", { name: "Add worksheet" }));
    await screen.findByRole("tab", { name: "Sheet2" });
    expect(tabNames()).toEqual(["Sheet1", "Notes", "Sheet2"]);
  });
});

describe("Rename a worksheet", () => {
  it("offers the Rename command in the tab menu and saves the trimmed name", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const menu = await openWorksheetMenu(user, "Sheet1");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Rename", "Delete"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));

    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    expect(input).toHaveProperty("value", "Sheet1");

    await user.clear(input);
    await user.type(input, "  Sales data  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("tab", { name: "Sales data" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Sheet1" })).toBeNull();
    // The worksheet itself is the same one: its values and its selected cell survive the rename.
    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("A2")).toBe("East");

    const reopened = await reopenEditor(backend);
    expect(screen.getByRole("tab", { name: "Sales data" }).getAttribute("aria-selected")).toBe("true");
    expect(cellValue("A2")).toBe("East");
    await reopened.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(cellValue("A1")).toBe(""));
  });

  it("rejects an empty name beside the text box and keeps the original tab", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const menu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });

    await user.clear(input);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Worksheet name cannot be empty")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "Worksheet name" })).toHaveProperty("value", "");
  });

  it("rejects a duplicate name and keeps both original tabs", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const menu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });

    await user.clear(input);
    await user.type(input, "Sheet1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Worksheet name already exists")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);

    // The name of the same worksheet may be re-saved without a duplicate rejection.
    await user.clear(input);
    await user.type(input, "Sheet2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });

  it("keeps the previous name and reports the failure when the save fails", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    backend.failNextRequest((method, path) => method === "PATCH" && path.endsWith("/worksheets/ws-q3-sales-sheet2"), {
      error: "Worksheet could not be renamed",
    });

    const menu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
    const input = within(dialog).getByRole("textbox", { name: "Worksheet name" });
    await user.clear(input);
    await user.type(input, "Notes");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Worksheet could not be renamed")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);

    await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });
});

describe("Delete a worksheet", () => {
  it("deletes the confirmed worksheet, activates its neighbor and keeps it deleted after reopening", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);

    const menu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(within(dialog).getByText("Sheet2")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toEqual(["Sheet1"]);
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    expect(cellValue("A2")).toBe("East");

    await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet1"]);
    expect(cellValue("B2")).toBe("1200");
  });

  it("removes the target's grid data together with its tab", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const menu = await openWorksheetMenu(user, "Sheet1");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    expect(within(dialog).getByText("Sheet1")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    await waitFor(() => expect(tabNames()).toEqual(["Sheet2"]));
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    expect(cellValue("A1")).toBe("");
    expect(cellValue("A2")).toBe("");
    expect(formulaBar()).toHaveProperty("value", "");

    await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet2"]);
    expect(cellValue("A1")).toBe("");
  });

  it("refuses to delete the last worksheet without opening the dialog", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const firstMenu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(firstMenu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));
    await waitFor(() => expect(tabNames()).toEqual(["Sheet1"]));

    const lastMenu = await openWorksheetMenu(user, "Sheet1");
    await user.click(within(lastMenu).getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
    expect(await screen.findByText("A workbook must contain at least one worksheet")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1"]);
  });

  it("refuses to delete a worksheet a pivot result still reads and keeps both untouched", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Create pivot table" }));
    const createDialog = await screen.findByRole("dialog", { name: "Create pivot table" });
    await user.click(within(createDialog).getByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Pivot table editor" });
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Pivot1"]);

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    const menu = await openWorksheetMenu(user, "Sheet1");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByText("Please delete or rebuild dependent pivot tables first")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull());
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Pivot1"]);
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("B3")).toBe("800");

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await waitFor(() => expect(cellValue("A1")).toBe("Region"));
    expect(cellValue("B1")).toBe("SUM of Sales");

    await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet1", "Sheet2", "Pivot1"]);
  });

  it("keeps the tab and reports the failure when the deletion fails", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    backend.failNextRequest(
      (method, path) => method === "DELETE" && path.endsWith("/worksheets/ws-q3-sales-sheet2"),
      { error: "Worksheet could not be deleted" },
    );

    const menu = await openWorksheetMenu(user, "Sheet2");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
    await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

    expect(await screen.findByText("Worksheet could not be deleted")).toBeTruthy();
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);

    await reopenEditor(backend);
    expect(tabNames()).toEqual(["Sheet1", "Sheet2"]);
  });
});

describe("Switch worksheets", () => {  it("switches grid, formula bar and selection to the target worksheet and keeps both sides", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    expect(formulaBar()).toHaveProperty("value", "Region");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(cellValue("A1")).toBe(""));
    expect(formulaBar()).toHaveProperty("value", "");

    selectCell("B2");
    await waitFor(() => expect(formulaBar()).toHaveProperty("value", ""));
    fireEvent.change(formulaBar(), { target: { value: "North" } });
    fireEvent.keyDown(formulaBar(), { key: "Enter" });
    await waitFor(() => expect(cellValue("B2")).toBe("North"));

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    expect(cellValue("B2")).toBe("1200");
    expect(cellValue("A1")).toBe("Region");
    expect(formulaBar()).toHaveProperty("value", "Region");

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(cellValue("B2")).toBe("North"));
    expect(cellValue("A2")).toBe("");

    // The workbook reopens on the last active tab with each worksheet's own data.
    await reopenEditor(backend);
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
    expect(cellValue("B2")).toBe("North");
    expect(cellValue("A2")).toBe("");
  });

  it("keeps validation entry points of each worksheet apart", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectCell("A2");
    await user.click(screen.getByRole("button", { name: "Data" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Data validation" }));
    const dialog = await screen.findByRole("dialog", { name: "Data validation" });
    await user.type(within(dialog).getByRole("textbox", { name: "Allowed values" }), "East, North");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(cellValue("A1")).toBe(""));
    expect(screen.queryByRole("button", { name: "Open dropdown for A2" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    expect(screen.getByRole("button", { name: "Open dropdown for A2" })).toBeTruthy();
  });
});
