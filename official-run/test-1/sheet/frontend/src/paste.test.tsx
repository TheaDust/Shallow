import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { installApiMock } from "./test/apiMock";
import { parsePasteText, pasteStartCoord } from "./paste";

const mock = installApiMock();

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
  mock.reset();
});

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
}

function expectCell(grid: HTMLElement, coord: string, value: string) {
  return waitFor(() =>
    expect(within(grid).getByRole("gridcell", { name: coord })).toHaveTextContent(value),
  );
}

/** Dispatch a native paste event carrying external clipboard text. */
function pasteText(text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  document.body.dispatchEvent(event);
}

async function enterValue(
  user: ReturnType<typeof userEvent.setup>,
  grid: HTMLElement,
  coord: string,
  value: string,
) {
  await user.click(within(grid).getByRole("gridcell", { name: coord }));
  const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(formulaBar);
  await user.type(formulaBar, value);
  await user.keyboard("{Enter}");
}

describe("parsePasteText / pasteStartCoord", () => {
  it("splits tab columns and newline rows, preserving empty fields", () => {
    expect(parsePasteText("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
    expect(parsePasteText("a\t\tb\nc")).toEqual([["a", "", "b"], ["c"]]);
    expect(parsePasteText("a\nb\n")).toEqual([["a"], ["b"]]);
    expect(parsePasteText("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("pasteStartCoord returns the top-left corner of the selection", () => {
    expect(pasteStartCoord({ current: "D1", end: "E2" })).toBe("D1");
    expect(pasteStartCoord({ current: "E2", end: "D1" })).toBe("D1");
    expect(pasteStartCoord({ current: "B2", end: "C3" })).toBe("B2");
    expect(pasteStartCoord({ current: "A1", end: "A1" })).toBe("A1");
  });
});

describe("REQ-3-1-2 paste two-dimensional table data", () => {
  it("Ctrl+V pastes the clipboard rectangle into the selected starting cell", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));

    pasteText("East\t1200\nNorth\t800");

    await expectCell(grid, "D1", "East");
    await expectCell(grid, "E1", "1200");
    await expectCell(grid, "D2", "North");
    await expectCell(grid, "E2", "800");
    // seeded source range is untouched
    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B1", "Qty");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B2", "4");
    // the pasted rectangle becomes the selected rectangle
    expect(within(grid).getByRole("gridcell", { name: "D1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(grid).getByRole("gridcell", { name: "E2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("pastes into the top-left corner when a range is selected", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    fireEvent.mouseDown(within(grid).getByRole("gridcell", { name: "E2" }));
    fireEvent.mouseOver(within(grid).getByRole("gridcell", { name: "D1" }));
    fireEvent.mouseUp(window);

    pasteText("East\t1200\nNorth\t800");

    await expectCell(grid, "D1", "East");
    await expectCell(grid, "E1", "1200");
    await expectCell(grid, "D2", "North");
    await expectCell(grid, "E2", "800");
  });

  it("preserves empty fields and clears target cells they cover", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await enterValue(user, grid, "D1", "x");
    await enterValue(user, grid, "E1", "y");
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));

    pasteText("East\t\t1200\nNorth\t800");

    await expectCell(grid, "D1", "East");
    await expectCell(grid, "E1", "");
    await expectCell(grid, "F1", "1200");
    await expectCell(grid, "D2", "North");
    await expectCell(grid, "E2", "800");
    expect(mock.workbooks()[0].sheets[0].cells.E1).toBeUndefined();
  });

  it("replaces formulas inside the target and dependent formulas recalculate", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await enterValue(user, grid, "A3", "2");
    await enterValue(user, grid, "B3", "3");
    await enterValue(user, grid, "F1", "=SUM(D1:E2)");
    await expectCell(grid, "F1", "0"); // empty target range sums to 0
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));

    pasteText("East\t1200\nNorth\t=2+3");

    await expectCell(grid, "D1", "East");
    await expectCell(grid, "E1", "1200");
    await expectCell(grid, "D2", "North");
    await expectCell(grid, "E2", "5"); // pasted formula recalculates in the grid
    await expectCell(grid, "F1", "1205"); // dependent formula updated (1200 + 5)
    // the pasted formula keeps its original text in the formula bar
    await user.click(within(grid).getByRole("gridcell", { name: "E2" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=2+3");
  });

  it("the grid context menu provides a Paste menuitem that pastes the clipboard", async () => {
    const user = userEvent.setup();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: async () => "East\t1200\nNorth\t800" },
      configurable: true,
    });
    try {
      renderApp();
      await openEditor(user);
      const grid = screen.getByRole("grid", { name: "Worksheet grid" });
      fireEvent.contextMenu(within(grid).getByRole("gridcell", { name: "D1" }), {
        clientX: 120,
        clientY: 90,
      });

      const pasteItem = await screen.findByRole("menuitem", { name: "Paste" });
      await user.click(pasteItem);

      await expectCell(grid, "D1", "East");
      await expectCell(grid, "E1", "1200");
      await expectCell(grid, "D2", "North");
      await expectCell(grid, "E2", "800");
    } finally {
      if (originalClipboard === undefined) {
        delete (navigator as { clipboard?: unknown }).clipboard;
      } else {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
        });
      }
    }
  });

  it("a failed paste shows an error and keeps every target cell's original value", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await enterValue(user, grid, "D1", "keep");

    mock.failNextPasteOp = "Paste rejected";
    pasteText("East\t1200\nNorth\t800");

    expect(await screen.findByRole("alert")).toHaveTextContent("Paste rejected");
    await expectCell(grid, "D1", "keep");
    await expectCell(grid, "E1", "");
    await expectCell(grid, "D2", "");
    await expectCell(grid, "E2", "");
    // no partial record on the server
    const cells = mock.workbooks()[0].sheets[0].cells;
    expect(cells.D1).toBe("keep");
    expect(cells.E1).toBeUndefined();
    expect(cells.D2).toBeUndefined();
    expect(cells.E2).toBeUndefined();
  });

  it("the pasted rectangle persists after refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    pasteText("East\t1200\nNorth\t800");
    await expectCell(grid, "E2", "800");

    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "D1", "East");
    await expectCell(reopened, "E1", "1200");
    await expectCell(reopened, "D2", "North");
    await expectCell(reopened, "E2", "800");
    await expectCell(reopened, "A1", "Item");
    await expectCell(reopened, "B2", "4");
    // selection of the pasted rectangle is restored
    expect(within(reopened).getByRole("gridcell", { name: "E2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
