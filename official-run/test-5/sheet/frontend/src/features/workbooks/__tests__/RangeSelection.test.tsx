import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { stubFetch, workbookFixture } from "./helpers";

const EDITOR = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${EDITOR}/worksheets/ws-q3-sheet1`;

afterEach(() => {
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

function selectedCoordinates(): string[] {
  return within(grid())
    .getAllByRole("gridcell")
    .filter((node) => node.getAttribute("aria-selected") === "true")
    .map((node) => node.getAttribute("aria-label") ?? "");
}

function stubEditor(seed = workbookFixture()) {
  return stubFetch((request) => {
    if (request.method === "GET" && request.path === EDITOR) return { body: { workbook: seed } };
    if (request.method === "PATCH" && request.path.startsWith(SHEET1)) return { body: { workbook: seed } };
    return undefined;
  });
}

describe("selecting a rectangular cell range", () => {
  it("selects a rectangle by dragging from one corner to the opposite one", async () => {
    const seed = workbookFixture();
    const { calls } = stubEditor(seed);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    expect(grid().getAttribute("aria-multiselectable")).toBe("true");
    expect(selectedCoordinates()).toEqual(["A1"]);

    fireEvent.mouseDown(cell("B2"));
    fireEvent.mouseEnter(cell("C3"));
    fireEvent.mouseUp(document);

    expect(selectedCoordinates().sort()).toEqual(["B2", "B3", "C2", "C3"]);
    expect(cell("A1").getAttribute("aria-selected")).toBe("false");
    expect(cell("D3").getAttribute("aria-selected")).toBe("false");
    expect(cell("B4").getAttribute("aria-selected")).toBe("false");

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "PATCH"
            && call.body?.activeCell === "B2"
            && call.body?.selectionFocus === "C3",
        ),
      ).toBe(true),
    );
  });

  it("replaces the previous rectangle when another cell is selected", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture();
    stubEditor(seed);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    fireEvent.mouseDown(cell("B2"));
    fireEvent.mouseEnter(cell("C3"));
    fireEvent.mouseUp(document);
    expect(selectedCoordinates().sort()).toEqual(["B2", "B3", "C2", "C3"]);

    await user.click(cell("D4"));
    expect(selectedCoordinates()).toEqual(["D4"]);

    fireEvent.mouseDown(cell("A1"));
    fireEvent.mouseEnter(cell("B1"));
    fireEvent.mouseUp(document);
    expect(selectedCoordinates().sort()).toEqual(["A1", "B1"]);
    expect(cell("C3").getAttribute("aria-selected")).toBe("false");
    // The rectangle is exactly the dragged one and never grows to the data next to it.
    expect(cell("A2").getAttribute("aria-selected")).toBe("false");
  });

  it("restores the stored rectangle of a worksheet after a refresh", async () => {
    const seed = workbookFixture({
      worksheets: [
        { ...workbookFixture().worksheets[0], activeCell: "B2", selectionFocus: "C3" },
        workbookFixture().worksheets[1],
      ],
    });
    stubEditor(seed);
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    expect(selectedCoordinates().sort()).toEqual(["B2", "B3", "C2", "C3"]);
    expect(cell("C4").getAttribute("aria-selected")).toBe("false");
  });

  it("keeps each worksheet's own rectangle while switching worksheets", async () => {
    const user = userEvent.setup();
    const seed = workbookFixture({
      worksheets: [
        { ...workbookFixture().worksheets[0], activeCell: "B2", selectionFocus: "C3" },
        {
          id: "ws-q3-sheet2",
          name: "Sheet2",
          activeCell: "A1",
          selectionFocus: "B2",
          cells: {},
          values: {},
          validations: [],
        },
      ],
    });
    stubFetch((request) => {
      if (request.method === "GET" && request.path === EDITOR) return { body: { workbook: seed } };
      if (request.method === "PATCH" && request.path === EDITOR) {
        return { body: { workbook: { ...seed, activeWorksheetId: request.body.activeWorksheetId } } };
      }
      if (request.method === "PATCH" && request.path.startsWith(SHEET1)) return { body: { workbook: seed } };
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(selectedCoordinates().sort()).toEqual(["B2", "B3", "C2", "C3"]);

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(selectedCoordinates().sort()).toEqual(["A1", "A2", "B1", "B2"]));

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(selectedCoordinates().sort()).toEqual(["B2", "B3", "C2", "C3"]));
  });

  it("restores the last accepted rectangle when the server rejects the selection", async () => {
    const seed = workbookFixture();
    stubFetch((request) => {
      if (request.method === "GET" && request.path === EDITOR) return { body: { workbook: seed } };
      if (request.method === "PATCH" && request.path.startsWith(SHEET1)) {
        return { status: 400, body: { error: "Invalid cell address" } };
      }
      return undefined;
    });
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });

    fireEvent.mouseDown(cell("B2"));
    fireEvent.mouseEnter(cell("C3"));
    fireEvent.mouseUp(document);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Invalid cell address");
    expect(selectedCoordinates()).toEqual(["A1"]);
  });
});
