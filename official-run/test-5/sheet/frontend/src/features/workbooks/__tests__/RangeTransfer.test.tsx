import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { workbookFixture } from "./helpers";
import { stubSheetServer } from "./sheetServer";

const SHEET1 = "/api/workbooks/wb-q3-sales/worksheets/ws-q3-sheet1";afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "#/workbooks/wb-q3-sales";
});

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(address: string) {
  return within(grid()).getByRole("gridcell", { name: address });
}

function selectRange(from: string, to: string) {
  fireEvent.mouseDown(cell(from));
  fireEvent.mouseEnter(cell(to));
  fireEvent.mouseUp(document);
}

function transferRequests(calls: ReturnType<typeof stubSheetServer>["calls"]) {
  return calls.filter((call) => call.method === "POST" && call.path.endsWith("/range-transfer"));
}

async function openEditor() {
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

describe("copying, cutting and pasting a cell range", () => {
  it("copies the dragged rectangle to the selected target cell and keeps the source", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    selectRange("A1", "B2");
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    await user.click(cell("D1"));
    fireEvent.paste(grid());

    await waitFor(() => expect(transferRequests(server.calls)).toHaveLength(1));
    expect(transferRequests(server.calls)[0].path).toBe(`${SHEET1}/range-transfer`);
    expect(transferRequests(server.calls)[0].body).toEqual({
      mode: "copy",
      source: { start: "A1", end: "B2" },
      target: { start: "D1", end: "D1" },
    });

    // The two-dimensional layout lands on D1:E2 and the source keeps its values.
    await waitFor(() => expect(cell("D2").textContent).toBe("East"));
    expect(cell("E2").textContent).toBe("1200");
    expect(cell("E1").textContent).toBe("Sales");
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("A2").textContent).toBe("East");
    // Cells outside both rectangles never change.
    expect(cell("C1").textContent).toBe("Status");
    expect(cell("D3").textContent).toBe("");
    expect(server.current().worksheets[0].cells.B2).toBe("1200");
  });

  it("offers Cut, Copy and Paste commands in the grid cell menu", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    await user.click(cell("D1"));
    fireEvent.contextMenu(cell("D1"), { clientX: 30, clientY: 40 });
    const menu = screen.getByRole("menu", { name: "Cell D1 menu" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Cut", "Copy", "Paste"]);

    await user.click(within(menu).getByRole("menuitem", { name: "Copy" }));
    expect(transferRequests(server.calls)).toHaveLength(0);
  });

  it("cuts through the menu, clears the source only when the target is displayed", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    selectRange("A2", "B2");
    fireEvent.contextMenu(cell("A2"), { clientX: 30, clientY: 40 });
    await user.click(screen.getByRole("menuitem", { name: "Cut" }));
    await user.click(cell("D4"));
    fireEvent.contextMenu(cell("D4"), { clientX: 30, clientY: 40 });
    await user.click(screen.getByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(transferRequests(server.calls)).toHaveLength(1));
    expect(transferRequests(server.calls)[0].body).toEqual({
      mode: "cut",
      source: { start: "A2", end: "B2" },
      target: { start: "D4", end: "D4" },
    });

    // The target shows the moved data and the source is empty in the same answer.
    await waitFor(() => expect(cell("D4").textContent).toBe("East"));
    expect(cell("E4").textContent).toBe("1200");
    expect(cell("A2").textContent).toBe("");
    expect(cell("B2").textContent).toBe("");
    expect(cell("A3").textContent).toBe("North");
  });

  it("reports a rejected transfer and keeps every cell of both ranges unchanged", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture(), {
      transferError: { status: 400, error: "Please enter a number from 0 to 100" },
    });
    await openEditor();

    selectRange("A1", "B1");
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    await user.click(cell("D1"));
    fireEvent.paste(grid());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Please enter a number from 0 to 100");
    await waitFor(() => expect(transferRequests(server.calls)).toHaveLength(1));
    // Neither the source nor the target moved.
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("D1").textContent).toBe("");
    expect(cell("E1").textContent).toBe("");
  });

  it("keeps the copied rectangle in its own worksheet and falls back to clipboard text elsewhere", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    selectRange("A1", "B2");
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(server.current().activeWorksheetId).toBe("ws-q3-sheet2"));
    await user.click(cell("A1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "x" } });

    await waitFor(() =>
      expect(server.calls.some((call) => call.method === "POST" && call.path.endsWith("/cells"))).toBe(true),
    );
    expect(transferRequests(server.calls)).toHaveLength(0);
    expect(cell("A1").textContent).toBe("x");
    expect(Object.hasOwn(server.sheet().cells, "A1")).toBe(true);
  });

  it("does not start a transfer when nothing was copied or cut", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "East\t1200" } });

    await waitFor(() =>
      expect(server.calls.some((call) => call.method === "POST" && call.path.endsWith("/cells"))).toBe(true),
    );
    expect(transferRequests(server.calls)).toHaveLength(0);
    expect(cell("D1").textContent).toBe("East");
    expect(cell("E1").textContent).toBe("1200");
  });
});
