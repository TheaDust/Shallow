import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { installApiMock } from "./test/apiMock";
import { adjustFormulaRefs, applyRangeTransfer, normalizeRect } from "./transfer";

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

/** Drag a selection rectangle in the grid. */
function dragSelect(grid: HTMLElement, from: string, to: string) {
  fireEvent.mouseDown(within(grid).getByRole("gridcell", { name: from }));
  fireEvent.mouseOver(within(grid).getByRole("gridcell", { name: to }));
  fireEvent.mouseUp(window);
}

describe("transfer pure helpers", () => {
  it("adjustFormulaRefs shifts relative references and keeps absolute ones", () => {
    expect(adjustFormulaRefs("=A1", 3, 0)).toBe("=D1");
    expect(adjustFormulaRefs("=$A$1", 3, 0)).toBe("=$A$1");
    expect(adjustFormulaRefs("=$A1", 3, 5)).toBe("=$A6");
    expect(adjustFormulaRefs("=A$1", 3, 5)).toBe("=D$1");
    expect(adjustFormulaRefs("=SUM(A1:B2)", 3, 0)).toBe("=SUM(D1:E2)");
    expect(adjustFormulaRefs("=A1+B1", -1, 0)).toBe("=#REF!+A1");
  });

  it("applyRangeTransfer copy/cut behaves atomically at the pure level", () => {
    const cells = { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" };
    const copied = applyRangeTransfer(cells, "copy", normalizeRect("A1", "B2")!, { col: 4, row: 1 });
    expect(copied.cells.D1).toBe("Item");
    expect(copied.cells.A1).toBe("Item");
    const cut = applyRangeTransfer(cells, "cut", normalizeRect("A1", "B2")!, { col: 4, row: 1 });
    expect(cut.cells.D1).toBe("Item");
    expect(cut.cells.A1).toBeUndefined();
  });
});

describe("REQ-3-2-1 copy, cut, and paste cell ranges", () => {
  it("copy keeps the source unchanged and pastes the 2D layout into the target", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    dragSelect(grid, "A1", "B2");
    // context menu Copy keeps the dragged rectangle as the source
    fireEvent.contextMenu(within(grid).getByRole("gridcell", { name: "B1" }), {
      clientX: 120,
      clientY: 90,
    });
    await user.click(await screen.findByRole("menuitem", { name: "Copy" }));

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    pasteText(""); // an empty external clipboard must not overwrite the internal copy

    await expectCell(grid, "D1", "Item");
    await expectCell(grid, "E1", "Qty");
    await expectCell(grid, "D2", "Pen");
    await expectCell(grid, "E2", "4");
    // source range remains unchanged
    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B1", "Qty");
    await expectCell(grid, "A2", "Pen");
    await expectCell(grid, "B2", "4");
    // the pasted rectangle becomes the selection
    expect(within(grid).getByRole("gridcell", { name: "E2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Ctrl+C then Ctrl+V copies the selected range into the target", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    dragSelect(grid, "A1", "B2");
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    pasteText("ignored text"); // internal clipboard wins over external text

    await expectCell(grid, "D1", "Item");
    await expectCell(grid, "E1", "Qty");
    await expectCell(grid, "D2", "Pen");
    await expectCell(grid, "E2", "4");
    await expectCell(grid, "A1", "Item");
    await expectCell(grid, "B2", "4");
  });

  it("cut clears the source only after the target is written, and persists after refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    dragSelect(grid, "A1", "B2");
    fireEvent.contextMenu(within(grid).getByRole("gridcell", { name: "A1" }), {
      clientX: 120,
      clientY: 90,
    });
    await user.click(await screen.findByRole("menuitem", { name: "Cut" }));

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    pasteText("");

    await expectCell(grid, "D1", "Item");
    await expectCell(grid, "E1", "Qty");
    await expectCell(grid, "D2", "Pen");
    await expectCell(grid, "E2", "4");
    await expectCell(grid, "A1", "");
    await expectCell(grid, "B1", "");
    await expectCell(grid, "A2", "");
    await expectCell(grid, "B2", "");

    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "D1", "Item");
    await expectCell(reopened, "E1", "Qty");
    await expectCell(reopened, "D2", "Pen");
    await expectCell(reopened, "E2", "4");
    await expectCell(reopened, "A1", "");
    await expectCell(reopened, "B2", "");
  });

  it("copying a formula adjusts relative references and keeps absolute ones; the formula bar shows the adjusted text", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });

    async function enterAt(coord: string, value: string) {
      await user.click(within(grid).getByRole("gridcell", { name: coord }));
      await user.clear(formulaBar);
      await user.type(formulaBar, value);
      await user.keyboard("{Enter}");
    }

    // source values: C5 = 5, F5 = 5, A5 = relative formula, B5 = absolute formula
    await enterAt("C5", "5");
    await enterAt("F5", "5");
    await enterAt("A5", "=C5");
    await expectCell(grid, "A5", "5");
    await enterAt("B5", "=$C$5");

    // copy A5:B5 to D5:E5
    dragSelect(grid, "A5", "B5");
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
    await user.click(within(grid).getByRole("gridcell", { name: "D5" }));
    pasteText("");

    // the adjusted relative formula recalculates from its new reference (F5 = 5)
    await expectCell(grid, "D5", "5");
    // the formula bar displays the adjusted original formula
    await user.click(within(grid).getByRole("gridcell", { name: "D5" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=F5");
    // the absolute reference is stored unchanged
    await user.click(within(grid).getByRole("gridcell", { name: "E5" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=$C$5");
    // the source formula remains unchanged
    await user.click(within(grid).getByRole("gridcell", { name: "A5" }));
    expect(screen.getByRole("textbox", { name: "Formula bar" })).toHaveValue("=C5");
  });

  it("a failed transfer shows an error and keeps source and target in their original state", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    dragSelect(grid, "A1", "B2");
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });

    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    mock.failNextTransferOp = "Transfer rejected";
    pasteText("");

    expect(await screen.findByRole("alert")).toHaveTextContent("Transfer rejected");
    await expectCell(grid, "A1", "Item"); // source unchanged
    await expectCell(grid, "B2", "4");
    await expectCell(grid, "D1", "");
    await expectCell(grid, "E1", "");
    await expectCell(grid, "D2", "");
    await expectCell(grid, "E2", "");
    // no partial record on the server
    const cells = mock.workbooks()[0].sheets[0].cells;
    expect(cells.D1).toBeUndefined();
    expect(cells.E1).toBeUndefined();
    expect(cells.D2).toBeUndefined();
    expect(cells.E2).toBeUndefined();
  });

  it("cut can be pasted multiple times only before the first successful paste", async () => {
    const user = userEvent.setup();
    renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    dragSelect(grid, "A1", "B2");
    fireEvent.keyDown(document.body, { key: "x", ctrlKey: true });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    pasteText("");
    await expectCell(grid, "E2", "4");
    await expectCell(grid, "A1", "");

    // a second Ctrl+V has no internal clipboard left: external text is pasted
    await user.click(within(grid).getByRole("gridcell", { name: "A10" }));
    pasteText("again");
    await expectCell(grid, "A10", "again");
    await expectCell(grid, "B10", "");
  });

  it("copy persists after refresh and reopening the workbook", async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();
    await openEditor(user);
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });

    dragSelect(grid, "A1", "B2");
    fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
    await user.click(within(grid).getByRole("gridcell", { name: "D1" }));
    pasteText("");
    await expectCell(grid, "E2", "4");

    unmount();
    renderApp();
    const reopened = await screen.findByRole("grid", { name: "Worksheet grid" });
    await expectCell(reopened, "D1", "Item");
    await expectCell(reopened, "E1", "Qty");
    await expectCell(reopened, "D2", "Pen");
    await expectCell(reopened, "E2", "4");
    await expectCell(reopened, "A1", "Item");
    await expectCell(reopened, "B2", "4");
    // the pasted rectangle is the restored selection
    expect(within(reopened).getByRole("gridcell", { name: "E2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
