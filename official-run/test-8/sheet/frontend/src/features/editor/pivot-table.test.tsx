import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

async function openEditor() {
  window.location.hash = "#/workbooks/workbook-q3-sales";
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { user, view };
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function gridCell(name: string): HTMLElement {
  return within(grid()).getByRole("gridcell", { name });
}

async function dragRange(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.pointer([
    { keys: "[MouseLeft>]", target: gridCell(from) },
    { target: gridCell(to) },
    { keys: "[/MouseLeft]" },
  ]);
}

/** Opens "Create pivot table" from the Data menu and confirms the dialog. */
async function createPivot(user: ReturnType<typeof userEvent.setup>, from = "A1", to = "C4") {
  await dragRange(user, from, to);
  await user.click(screen.getByRole("button", { name: "Data" }));
  await user.click(await screen.findByRole("menuitem", { name: "Create pivot table" }));
  const dialog = await screen.findByRole("dialog", { name: "Create pivot table" });
  return dialog;
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboLabel: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: comboLabel }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("creating a pivot table", () => {
  it("creates Pivot1 from the selected range and shows the default summary", async () => {
    const { user } = await openEditor();
    const dialog = await createPivot(user);

    // The dialog names the source range and offers the "New worksheet" radio.
    expect(within(dialog).getByText("Source range: A1:C4")).not.toBeNull();
    expect(within(dialog).getByRole("radio", { name: "New worksheet" })).not.toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const tab = await screen.findByRole("tab", { name: "Pivot1" });
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    expect(gridCell("A1").textContent).toBe("Region");
    expect(gridCell("B1").textContent).toBe("SUM of Sales");
    expect(["A2", "A3", "A4", "A5"].map((name) => gridCell(name).textContent)).toEqual([
      "East",
      "North",
      "South",
      "Grand Total",
    ]);
    expect(["B2", "B3", "B4", "B5"].map((name) => gridCell(name).textContent)).toEqual([
      "1200",
      "800",
      "700",
      "2700",
    ]);
  });

  it("exposes the Pivot table editor with field combo boxes named by the source headers", async () => {
    const { user } = await openEditor();
    const dialog = await createPivot(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const editor = await screen.findByRole("region", { name: "Pivot table editor" });
    expect(within(editor).getByRole("combobox", { name: "Rows" })).not.toBeNull();
    expect(within(editor).getByRole("combobox", { name: "Values" })).not.toBeNull();

    await user.click(within(editor).getByRole("combobox", { name: "Rows" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Region", "Sales", "Status"]);

    // "Summarize by" offers the three named methods.
    await user.click(within(editor).getByRole("combobox", { name: "Summarize by" }));
    await screen.findByRole("option", { name: "SUM" });
    expect(screen.getByRole("option", { name: "COUNT" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "AVERAGE" })).not.toBeNull();
  });

  it("applies COUNT and keeps the source worksheet's values and order", async () => {
    const { user } = await openEditor();
    const dialog = await createPivot(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Pivot table editor" });

    await chooseOption(user, "Summarize by", "COUNT");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(gridCell("B1").textContent).toBe("COUNT of Sales"));
    expect(["B2", "B3", "B4", "B5"].map((name) => gridCell(name).textContent)).toEqual([
      "1",
      "1",
      "1",
      "3",
    ]);

    // Switching back to the source worksheet keeps the original values/order.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("tab", { name: "Sheet1", selected: true });
    expect(["A2", "A3", "A4"].map((name) => gridCell(name).textContent)).toEqual([
      "East",
      "North",
      "South",
    ]);
    expect(["B2", "B3", "B4"].map((name) => gridCell(name).textContent)).toEqual([
      "1200",
      "800",
      "700",
    ]);
    expect(backend.workbooks[0].worksheets[0].cells.B2).toBe("1200");
  });

  it("refreshes the summary from the current source range", async () => {
    const { user } = await openEditor();
    const dialog = await createPivot(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Pivot table editor" });
    expect(gridCell("B5").textContent).toBe("2700");

    // Edit the source worksheet, then return and refresh the pivot result.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("tab", { name: "Sheet1", selected: true });
    await user.click(gridCell("B4"));
    await user.keyboard("1000{Enter}");

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await screen.findByRole("tab", { name: "Pivot1", selected: true });
    // The stale result is still shown until the explicit refresh.
    expect(gridCell("B5").textContent).toBe("2700");

    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    await waitFor(() => expect(gridCell("B4").textContent).toBe("1000"));
    expect(gridCell("B5").textContent).toBe("3000");
  });

  it("keeps Pivot1 and its results after reopening the workbook", async () => {
    const { user, view } = await openEditor();
    const dialog = await createPivot(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Pivot table editor" });
    await waitFor(() => expect(gridCell("B5").textContent).toBe("2700"));

    view.unmount();
    const reopened = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    const tab = await screen.findByRole("tab", { name: "Pivot1" });
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    expect(gridCell("B1").textContent).toBe("SUM of Sales");
    expect(gridCell("B2").textContent).toBe("1200");
    expect(gridCell("B5").textContent).toBe("2700");
    expect(screen.getByRole("region", { name: "Pivot table editor" })).not.toBeNull();
    reopened.unmount();
  });

  it("shows 'Value field requires numeric values' and keeps the last successful result", async () => {
    const { user } = await openEditor();
    const dialog = await createPivot(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Pivot table editor" });
    await waitFor(() => expect(gridCell("B1").textContent).toBe("SUM of Sales"));

    // Status holds text, so SUM over it is rejected without touching the result.
    await chooseOption(user, "Values", "Status");
    await chooseOption(user, "Summarize by", "SUM");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Value field requires numeric values")).not.toBeNull();
    expect(gridCell("B1").textContent).toBe("SUM of Sales");
    expect(gridCell("B5").textContent).toBe("2700");
  });

  it("shows the missing-field error after the source header is deleted", async () => {
    const { user } = await openEditor();
    const dialog = await createPivot(user);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByRole("region", { name: "Pivot table editor" });

    // Deleting the Sales column removes the pivot's value field header.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await screen.findByRole("tab", { name: "Sheet1", selected: true });
    const header = within(grid()).getByRole("columnheader", { name: "B" });
    fireEvent.contextMenu(header);
    const menu = await screen.findByRole("menu", { name: "Column B menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));
    await waitFor(() => expect(gridCell("B2").textContent).toBe("Open"));

    await user.click(screen.getByRole("tab", { name: "Pivot1" }));
    await screen.findByRole("tab", { name: "Pivot1", selected: true });
    expect(
      await screen.findByText("Pivot field is no longer available. Select a new field."),
    ).not.toBeNull();
    // The last successful result is preserved.
    expect(gridCell("B1").textContent).toBe("SUM of Sales");

    await user.click(screen.getByRole("button", { name: "Refresh pivot table" }));
    expect(
      await screen.findByText("Pivot field is no longer available. Select a new field."),
    ).not.toBeNull();
  });
});
