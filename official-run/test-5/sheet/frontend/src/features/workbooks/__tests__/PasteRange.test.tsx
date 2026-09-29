import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { sheetWithCells, stubFetch, workbookFixture } from "./helpers";
import type { WorkbookData } from "../types";

const EDITOR = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${EDITOR}/worksheets/ws-q3-sheet1`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

function withSheet1(seed: WorkbookData, cells: Record<string, string>): WorkbookData {
  return { ...seed, worksheets: [{ ...seed.worksheets[0], cells, values: cells }, seed.worksheets[1]] };
}

function stubEditor(seed: WorkbookData, cellsResult?: () => { status?: number; body: unknown }) {
  let current = seed;
  const { calls } = stubFetch((request) => {
    if (request.method === "GET" && request.path === EDITOR) return { body: { workbook: current } };
    if (request.method === "PATCH" && request.path.startsWith(SHEET1)) return { body: { workbook: current } };
    if (request.method === "POST" && request.path === `${SHEET1}/cells`) {
      if (cellsResult) return cellsResult();
      current = withSheet1(current, { ...current.worksheets[0].cells, ...request.body?.updates });
      return { body: { workbook: current } };
    }
    return undefined;
  });
  return { calls };
}

function pasteText(text: string) {
  fireEvent.paste(grid(), { clipboardData: { getData: () => text } });
}

describe("pasting a two-dimensional table", () => {
  it("applies tab-separated rows starting at the selected cell and shows every value", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = stubEditor(seed);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(cell("D1"));
    pasteText("East\t1200\nNorth\t800");

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST"
            && call.body?.updates?.D1 === "East"
            && call.body?.updates?.E1 === "1200"
            && call.body?.updates?.D2 === "North"
            && call.body?.updates?.E2 === "800",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(cell("E1").textContent).toBe("1200");
    expect(cell("D2").textContent).toBe("North");
    expect(cell("E2").textContent).toBe("800");
    // Cells outside the pasted rectangle are untouched.
    expect(cell("A1").textContent).toBe("Region");
    expect(cell("D3").textContent).toBe("");
  });

  it("keeps empty fields of the pasted rectangle and clears the cells they cover", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture({
      worksheets: [sheetWithCells({ A1: "Region", D1: "old", E1: "old" }), workbookFixture().worksheets[1]],
    });
    const { calls } = stubEditor(seed);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(cell("D1"));
    pasteText("East\t\n\t800");

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const pasted = calls.find((call) => call.method === "POST")!;
    expect(pasted.body.updates).toEqual({ D1: "East", E1: "", D2: "", E2: "800" });
    await waitFor(() => expect(cell("E1").textContent).toBe(""));
    expect(cell("E2").textContent).toBe("800");
  });

  it("offers a Paste command with the menuitem role in the grid context menu", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = stubEditor(seed);
    const readText = vi.fn(async () => "East\t1200");
    Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(cell("D1"));
    fireEvent.contextMenu(cell("D1"), { clientX: 30, clientY: 40 });
    const paste = screen.getByRole("menuitem", { name: "Paste" });
    await user.click(paste);

    await waitFor(() => expect(readText).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === "POST" && call.body?.updates?.D1 === "East" && call.body?.updates?.E1 === "1200",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(cell("E1").textContent).toBe("1200");
  });

  it("keeps every target cell on its original value when the paste is rejected", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture({
      worksheets: [sheetWithCells({ A1: "Region", D1: "50", E1: "60" }), workbookFixture().worksheets[1]],
    });
    stubEditor(seed, () => ({ status: 400, body: { error: "Please enter a number from 0 to 100" } }));
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(cell("D1"));
    pasteText("10\t20\n30\t400");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Please enter a number from 0 to 100");
    expect(cell("D1").textContent).toBe("50");
    expect(cell("E1").textContent).toBe("60");
    expect(cell("D2").textContent).toBe("");
    expect(cell("E2").textContent).toBe("");
  });

  it("pastes into the top-left corner of a dragged rectangle", async () => {
    const seed = workbookFixture();
    const { calls } = stubEditor(seed);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    // Dragging from the opposite corner keeps D1:E2 as the target rectangle.
    fireEvent.mouseDown(cell("E2"));
    fireEvent.mouseEnter(cell("D1"));
    fireEvent.mouseUp(document);
    pasteText("East\t1200\nNorth\t800");

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST"
            && call.body?.updates?.D1 === "East"
            && call.body?.updates?.E1 === "1200"
            && call.body?.updates?.D2 === "North"
            && call.body?.updates?.E2 === "800",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
  });

  it("reports an unreadable clipboard instead of dropping the paste silently", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    const { calls } = stubEditor(seed);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    await user.click(cell("D1"));
    fireEvent.contextMenu(cell("D1"), { clientX: 30, clientY: 40 });
    await user.click(screen.getByRole("menuitem", { name: "Paste" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("clipboard");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(cell("D1").textContent).toBe("");
  });
});
