import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";

import { App } from "./App";
import {
  SEED_SECOND_WORKSHEET_ID,
  SEED_WORKBOOK_ID,
  SEED_WORKSHEET_ID,
  installFakeApi,
  type FakeApi,
} from "./test/fake-api";

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

async function openWorksheetMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Worksheet options for ${name}` }));
  return screen.findByRole("menu", { name: `Worksheet options for ${name}` });
}

test("the tab bar shows worksheet order, active state and an Add worksheet button", async () => {
  api = installFakeApi();
  render(<App />);
  await grid();

  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(tabs[1].getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("button", { name: "Add worksheet" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Worksheet options for Sheet1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Worksheet options for Sheet2" })).toBeTruthy();
});

test("the worksheet options menu exposes a Rename menuitem that opens the rename dialog", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet1");
  const rename = within(menu).getByRole("menuitem", { name: "Rename" });
  await user.click(rename);

  const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
  const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;
  expect(input.value).toBe("Sheet1");
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeTruthy();
});

test("renaming a worksheet updates the tab, leaves the other worksheets and survives a refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet2");
  await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
  const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;
  expect(input.value).toBe("Sheet2");

  await user.clear(input);
  await user.type(input, "  Revenue  ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rename worksheet" })).toBeNull());
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Revenue"]);
  // The other worksheet keeps its own grid values.
  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  expect(api!.workbooks[0].worksheets[1].name).toBe("Revenue");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Revenue"]);
});

test("an empty worksheet name is rejected and the original name remains", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet1");
  await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
  const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;

  await user.clear(input);
  await user.type(input, "   ");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name cannot be empty");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
});

test("a duplicate worksheet name is rejected and the original name remains", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet1");
  await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
  const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;

  await user.clear(input);
  await user.type(input, "Sheet2");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Worksheet name already exists");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
});

test("a failed worksheet rename reports an error and keeps the original name after refresh", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("PATCH", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`);
  const view = render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet1");
  await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename worksheet" });
  const input = within(dialog).getByRole("textbox", { name: "Worksheet name" }) as HTMLInputElement;
  await user.clear(input);
  await user.type(input, "Revenue");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  const error = await within(dialog).findByRole("alert");
  expect(error.textContent).toBe("Server error");
  expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  expect(api.workbooks[0].worksheets[0].name).toBe("Sheet1");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("tab", { name: "Sheet1" })).toBeTruthy();
});

test("adding a worksheet creates the next SheetN tab, makes it active and persists it", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  await user.click(screen.getByRole("button", { name: "Add worksheet" }));

  await waitFor(() =>
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]),
  );
  const added = screen.getByRole("tab", { name: "Sheet3" });
  expect(added.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
  // Existing worksheets keep their data; switching back shows the new blank tab has its own grid.
  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
  await user.click(screen.getByRole("tab", { name: "Sheet3" }));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Sheet3"]);
  expect(screen.getByRole("tab", { name: "Sheet3" }).getAttribute("aria-selected")).toBe("true");
});

test("a failed worksheet addition shows an error and leaves the existing tabs unchanged", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("POST", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets`);
  render(<App />);
  await grid();

  await user.click(screen.getByRole("button", { name: "Add worksheet" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
  expect(api.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet1", "Sheet2"]);
});

test("switching worksheets shows only the active worksheet grid values", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  await user.click(screen.getByRole("tab", { name: "Sheet2" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true"),
  );
  expect(screen.getByRole("gridcell", { name: "A1" }).textContent).toBe("");
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");

  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("East");
});

test("switching restores each worksheet's own selected cell, formula bar text and filter buttons", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  // Sheet1 holds an ordinary value and a formula: the bar shows the raw text,
  // the grid the calculated result.
  api.workbooks[0].worksheets[0].cells.B2 = "=1200+1";
  const view = render(<App />);
  await grid();

  const bar = () => screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
  await user.click(screen.getByRole("gridcell", { name: "B2" }));
  expect(bar().value).toBe("=1200+1");
  expect(screen.getByRole("gridcell", { name: "B2" }).textContent).toBe("1201");
  await waitFor(() =>
    expect(api!.workbooks[0].worksheets[0].selection).toEqual({ anchor: "B2", focus: "B2" }),
  );

  // A filter view on Sheet1 exposes one "Filter <header>" button per header.
  await user.click(screen.getByRole("button", { name: "Data" }));
  const dataMenu = await screen.findByRole("menu");
  await user.click(within(dataMenu).getByRole("menuitem", { name: "Create filter" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy());

  // Sheet2 has no selection history (A1) and no filter of its own.
  await user.click(screen.getByRole("tab", { name: "Sheet2" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
  expect(bar().value).toBe("");
  expect(screen.queryByRole("button", { name: "Filter Region" })).toBeNull();

  // Returning to Sheet1 restores its selection, raw formula and filter buttons.
  await user.click(screen.getByRole("tab", { name: "Sheet1" }));
  await waitFor(() => expect(bar().value).toBe("=1200+1"));
  expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("button", { name: "Filter Region" })).toBeTruthy();

  // Reopening the workbook shows the last active tab and the stored selection.
  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
  expect(bar().value).toBe("=1200+1");
});

test("the worksheet options menu exposes a Delete menuitem that opens the Delete worksheet dialog", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet2");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

  const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
  expect(within(dialog).getByText(/Sheet2/)).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Delete worksheet" })).toBeTruthy();
});

test("deleting a worksheet removes its tab, activates an adjacent one and persists it", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  const view = render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet1");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
  await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull());
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet2"]);
  expect(screen.getByRole("tab", { name: "Sheet2" }).getAttribute("aria-selected")).toBe("true");
  // The deleted worksheet's data is gone; the remaining one is shown.
  expect(screen.getByRole("gridcell", { name: "A2" }).textContent).toBe("");
  expect(api!.workbooks[0].worksheets.map((worksheet) => worksheet.name)).toEqual(["Sheet2"]);

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet2"]);
});

test("a failed delete reports an error and keeps the target worksheet", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  api.failOnce("DELETE", `/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_SECOND_WORKSHEET_ID}`);
  const view = render(<App />);
  await grid();

  const menu = await openWorksheetMenu(user, "Sheet2");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
  await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Server error");
  expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);

  view.unmount();
  render(<App />);
  await grid();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2"]);
});

test("deleting the only remaining worksheet reports the message without a dialog", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  // Remove Sheet2 so only Sheet1 is left.
  let menu = await openWorksheetMenu(user, "Sheet2");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
  let dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
  await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));
  await waitFor(() => expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1"]));

  menu = await openWorksheetMenu(user, "Sheet1");
  await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

  expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("A workbook must contain at least one worksheet");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1"]);
});

test("deleting a pivot source worksheet is rejected and preserves both worksheets", async () => {
  const user = userEvent.setup();
  api = installFakeApi();
  render(<App />);
  await grid();

  // Create a pivot result worksheet reading Sheet1.
  await user.click(screen.getByRole("button", { name: "Data" }));
  let menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: "Create pivot table" }));
  const createDialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  await user.click(within(createDialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Pivot1" })).toBeTruthy());

  // Sheet1 is still a pivot source: confirming the deletion is rejected.
  const options = await openWorksheetMenu(user, "Sheet1");
  await user.click(within(options).getByRole("menuitem", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete worksheet" });
  await user.click(within(dialog).getByRole("button", { name: "Delete worksheet" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Please delete or rebuild dependent pivot tables first");
  expect(screen.queryByRole("dialog", { name: "Delete worksheet" })).toBeNull();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Sheet1", "Sheet2", "Pivot1"]);
  // Both worksheets remain: the source data and the pivot result are unchanged.
  expect(api!.workbooks[0].worksheets.find((worksheet) => worksheet.name === "Sheet1")!.cells.A2).toBe("East");
  expect(api!.workbooks[0].worksheets.find((worksheet) => worksheet.name === "Pivot1")!.cells.B5).toBe("2700");
});
