import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import {
  SHEET1,
  WORKBOOK_ID,
  installFakeWorkbookApi,
  type FakeApiOptions,
} from "../test/fake-workbook-api";

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

function dragSelect(from: string, to: string) {
  fireEvent.mouseDown(cell(from), { button: 0 });
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document.body);
}

function install(options: FakeApiOptions = {}) {
  return installFakeWorkbookApi(options);
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

describe("copying and pasting a rectangular range", () => {
  it("copies the dragged rectangle into a target location and keeps the source", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("A1", "B2");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell("D1"));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(cell("D1").textContent).toBe("Region"));
    expect(cell("D2").textContent).toBe("East");
    expect(cell("E2").textContent).toBe("1200");
    // The source rectangle is untouched.
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");

    const transfer = api.calls.find((call) => call.path.endsWith("/range-transfer"));
    expect(transfer?.method).toBe("POST");
    expect(transfer?.path).toBe(`/api/workbooks/${WORKBOOK_ID}/sheets/${SHEET1}/range-transfer`);
    expect(transfer?.body).toEqual({
      source: { start: "A1", end: "B2" },
      target: { start: "D1", end: "D1" },
      mode: "copy",
    });
  });

  it("keeps the pasted values and the source after the workbook is reopened", async () => {
    install();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("A1", "B2");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell("D1"));
    await user.click(screen.getByRole("button", { name: "Paste" }));
    await waitFor(() => expect(cell("E2").textContent).toBe("1200"));

    window.location.hash = "#/";
    window.location.hash = `#/workbooks/${WORKBOOK_ID}`;
    await waitFor(() => expect(cell("E2").textContent).toBe("1200"));
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("B2").textContent).toBe("1200");
  });

  it("cuts the rectangle, clearing the source only once the target holds every value", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("B2", "B3");
    await user.click(screen.getByRole("button", { name: "Cut" }));
    // The source is still filled before the paste.
    expect(cell("B2").textContent).toBe("1200");
    expect(cell("B3").textContent).toBe("800");

    await user.click(cell("D5"));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    await waitFor(() => expect(cell("D5").textContent).toBe("1200"));
    expect(cell("D6").textContent).toBe("800");
    expect(cell("B2").textContent).toBe("");
    expect(cell("B3").textContent).toBe("");
    expect(cell("A2").textContent).toBe("East");

    const transfer = api.calls.find((call) => call.path.endsWith("/range-transfer"));
    expect(transfer?.body).toEqual({
      source: { start: "B2", end: "B3" },
      target: { start: "D5", end: "D5" },
      mode: "cut",
    });
  });

  it("refuses the whole transfer and shows the rule message when the target rejects it", async () => {
    install({ transferStatus: 400, transferError: "Please enter a number from 0 to 100" });
    const user = userEvent.setup();
    await openEditor();

    dragSelect("A2", "B2");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell("D2"));
    await user.click(screen.getByRole("button", { name: "Paste" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Please enter a number from 0 to 100");
    expect(cell("D2").textContent).toBe("");
    expect(cell("A2").textContent).toBe("East");
    expect(cell("B2").textContent).toBe("1200");
  });

  it("pastes the copied range with Ctrl+V, keeping the adjusted formula in the formula bar", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    // A formula copied one column right and one row down adjusts its relative references.
    // Its operands are numeric cells: a text operand would be an error in the real engine.
    await user.click(cell("C1"));
    await user.clear(formulaBar());
    await user.type(formulaBar(), "=B2+B3");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(cell("C1").textContent).toBe("2000"));

    dragSelect("C1", "C1");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(cell("D2"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "=B2+B3" } });

    await waitFor(() => expect(api.calls.some((call) => call.path.endsWith("/range-transfer"))).toBe(true));
    expect(api.calls.some((call) => call.path.endsWith("/paste"))).toBe(false);
    await user.click(cell("D2"));
    expect(formulaBar().value).toBe("=C3+C4");
  });

  it("pastes external tab separated text with Ctrl+V when nothing was copied in the grid", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "South\t700" } });

    await waitFor(() => expect(cell("D1").textContent).toBe("South"));
    expect(cell("E1").textContent).toBe("700");
    const paste = api.calls.find((call) => call.path.endsWith("/paste"));
    expect(paste?.body).toEqual({ start: "D1", text: "South\t700" });
  });

  it("offers Copy, Cut and Paste menuitems in the cell context menu", async () => {
    const api = install();
    const user = userEvent.setup();
    await openEditor();

    dragSelect("A1", "B2");
    await waitFor(() => expect(api.workbooks[0].sheets[0].selection).toEqual({ start: "A1", end: "B2" }));

    // Right-clicking inside the rectangle keeps it as the copied source.
    fireEvent.contextMenu(cell("B2"));
    const copy = await screen.findByRole("menuitem", { name: "Copy" });
    expect(screen.getByRole("menuitem", { name: "Cut" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Paste" })).toBeTruthy();
    await user.click(copy);

    await user.click(cell("D1"));
    const paste = screen.queryByRole("menuitem", { name: "Paste" });
    expect(paste).toBeNull();
    fireEvent.contextMenu(cell("D1"));
    await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(cell("D1").textContent).toBe("Region"));
    expect(cell("E1").textContent).toBe("Sales");
    expect(cell("D2").textContent).toBe("East");
    expect(cell("E2").textContent).toBe("1200");
    expect(api.calls.some((call) => call.path.endsWith("/range-transfer"))).toBe(true);
  });
});
