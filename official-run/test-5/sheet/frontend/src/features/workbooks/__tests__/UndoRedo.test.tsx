import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "../WorkbookEditorPage";
import { workbookFixture } from "./helpers";
import { stubSheetServer } from "./sheetServer";

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

function undoButton() {
  return screen.getByRole("button", { name: "Undo" });
}

function redoButton() {
  return screen.getByRole("button", { name: "Redo" });
}

function historyRequests(calls: ReturnType<typeof stubSheetServer>["calls"], direction: "undo" | "redo") {
  return calls.filter((call) => call.method === "POST" && call.path.endsWith(`/${direction}`));
}

function disabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

async function openEditor() {
  render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
  await screen.findByRole("heading", { name: "Q3 Sales" });
}

/** Types a value into the selected cell from the formula bar and commits it. */
async function editSelectedCell(text: string) {
  const user = userEvent.setup();
  const formulaBar = screen.getByRole("textbox", { name: "Formula bar" });
  await user.clear(formulaBar);
  await user.type(formulaBar, text);
  await user.keyboard("{Enter}");
}

describe("undoing and redoing recent operations", () => {
  it("exposes the Undo and Redo buttons, disabled while there is nothing to restore", async () => {
    stubSheetServer(workbookFixture());
    await openEditor();

    expect(disabled(undoButton())).toBe(true);
    expect(disabled(redoButton())).toBe(true);
  });

  it("undoes a committed cell edit and redoes it again", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    await user.click(cell("D1"));
    await editSelectedCell("East");
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));

    // A successful write enables Undo and keeps Redo unavailable.
    await waitFor(() => expect(disabled(undoButton())).toBe(false));
    expect(disabled(redoButton())).toBe(true);

    await user.click(undoButton());
    await waitFor(() => expect(historyRequests(server.calls, "undo")).toHaveLength(1));
    await waitFor(() => expect(cell("D1").textContent).toBe(""));
    expect(cell("A1").textContent).toBe("Region");
    await waitFor(() => expect(disabled(redoButton())).toBe(false));

    await user.click(redoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(server.current().worksheets[0].cells.D1).toBe("East");
    await waitFor(() => expect(disabled(redoButton())).toBe(true));
  });

  it("performs the same operations from Ctrl+Z and Ctrl+Y", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    await user.click(cell("D2"));
    await editSelectedCell("North");
    await waitFor(() => expect(cell("D2").textContent).toBe("North"));

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    await waitFor(() => expect(cell("D2").textContent).toBe(""));
    expect(historyRequests(server.calls, "undo")).toHaveLength(1);

    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    await waitFor(() => expect(cell("D2").textContent).toBe("North"));
    expect(historyRequests(server.calls, "redo")).toHaveLength(1);
  });

  it("restores a pasted rectangle from the answer of the server", async () => {
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    fireEvent.mouseDown(cell("D1"));
    fireEvent.mouseUp(document);
    fireEvent.paste(grid(), { clipboardData: { getData: () => "East\t1200\nNorth\t800" } });
    await waitFor(() => expect(cell("E2").textContent).toBe("800"));

    await userEvent.setup().click(undoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe(""));
    expect(cell("E2").textContent).toBe("");
    expect(cell("A1").textContent).toBe("Region");
    expect(historyRequests(server.calls, "undo")).toHaveLength(1);
  });

  it("restores a row insertion and disables Ctrl+Y after a new modification", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    fireEvent.contextMenu(within(grid()).getByRole("rowheader", { name: "2" }), { clientX: 40, clientY: 60 });
    await user.click(screen.getByRole("menuitem", { name: "Insert 1 row below" }));
    await waitFor(() => expect(cell("A4").textContent).toBe("North"));
    expect(cell("A2").textContent).toBe("East");
    await waitFor(() => expect(disabled(undoButton())).toBe(false));

    await user.click(undoButton());
    await waitFor(() => expect(cell("A3").textContent).toBe("North"));
    expect(cell("A4").textContent).toBe("South");

    // A new modification after the undo drops the redo branch entirely.
    await user.click(cell("D1"));
    await editSelectedCell("East");
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    expect(disabled(redoButton())).toBe(true);
    expect(historyRequests(server.calls, "redo")).toHaveLength(0);

    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(historyRequests(server.calls, "redo")).toHaveLength(0);
    expect(cell("A4").textContent).toBe("South");
    expect(cell("D1").textContent).toBe("East");
  });

  it("keeps the undone state after the workbook is reopened", async () => {
    const user = userEvent.setup();
    const server = stubSheetServer(workbookFixture());
    await openEditor();

    await user.click(cell("D1"));
    await editSelectedCell("East");
    await waitFor(() => expect(cell("D1").textContent).toBe("East"));
    await user.click(undoButton());
    await waitFor(() => expect(cell("D1").textContent).toBe(""));

    // Reopening the editor page reads the stored state, not the session history.
    cleanup();
    render(<WorkbookEditorPage workbookId="wb-q3-sales" />);
    await screen.findByRole("heading", { name: "Q3 Sales" });
    expect(cell("D1").textContent).toBe("");
    expect(server.current().worksheets[0].cells.D1).toBeUndefined();
  });
});
