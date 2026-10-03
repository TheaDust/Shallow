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

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
}

function worksheet(index = 0) {
  return backend.workbooks[0].worksheets[index];
}

async function editCell(user: ReturnType<typeof userEvent.setup>, coordinate: string, text: string) {
  await user.click(gridCell(coordinate));
  await user.clear(formulaBar());
  await user.type(formulaBar(), text);
  await user.keyboard("{Enter}");
}

describe("undo and redo", () => {
  it("offers Undo/Redo in the toolbar, disabled until an operation happened", async () => {
    const { user } = await openEditor();

    const toolbar = screen.getByRole("toolbar", { name: "Workbook toolbar" });
    expect((within(toolbar).getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(toolbar).getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);

    await editCell(user, "D1", "East");

    await waitFor(() => expect(undoButton().disabled).toBe(false));
    expect(redoButton().disabled).toBe(true);
  });

  it("restores the value an edit replaced and persists the undone state after reopening", async () => {
    const { user, view } = await openEditor();

    await editCell(user, "A1", "West");
    await waitFor(() => expect(gridCell("A1").textContent).toBe("West"));

    await user.click(undoButton());

    await waitFor(() => expect(gridCell("A1").textContent).toBe("Region"));
    expect(worksheet().cells.A1).toBe("Region");
    await waitFor(() => expect(redoButton().disabled).toBe(false));

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(gridCell("A1").textContent).toBe("Region");
    expect(worksheet().cells.A1).toBe("Region");
  });

  it("redoes the operation it just undid through the toolbar button", async () => {
    const { user } = await openEditor();

    await editCell(user, "A1", "West");
    await waitFor(() => expect(gridCell("A1").textContent).toBe("West"));

    await user.click(undoButton());
    await waitFor(() => expect(gridCell("A1").textContent).toBe("Region"));

    await user.click(redoButton());
    await waitFor(() => expect(gridCell("A1").textContent).toBe("West"));
    expect(worksheet().cells.A1).toBe("West");
    expect(redoButton().disabled).toBe(true);
  });

  it("performs the same operations through Ctrl+Z and Ctrl+Y", async () => {
    const { user } = await openEditor();

    await editCell(user, "B2", "900");
    await waitFor(() => expect(gridCell("B2").textContent).toBe("900"));

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(gridCell("B2").textContent).toBe("1200"));

    await user.keyboard("{Control>}y{/Control}");
    await waitFor(() => expect(gridCell("B2").textContent).toBe("900"));
  });

  it("restores consecutive edits in reverse order", async () => {
    const { user } = await openEditor();

    await editCell(user, "D1", "East");
    await editCell(user, "D2", "North");
    await waitFor(() => expect(gridCell("D2").textContent).toBe("North"));

    await user.click(undoButton());
    await waitFor(() => expect(gridCell("D2").textContent).toBe(""));
    expect(gridCell("D1").textContent).toBe("East");

    await user.click(undoButton());
    await waitFor(() => expect(gridCell("D1").textContent).toBe(""));
    expect(undoButton().disabled).toBe(true);
  });

  it("disables Redo after a new modification and ignores Ctrl+Y for the old branch", async () => {
    const { user } = await openEditor();

    await editCell(user, "D1", "East");
    await waitFor(() => expect(undoButton().disabled).toBe(false));
    await user.click(undoButton());
    await waitFor(() => expect(redoButton().disabled).toBe(false));

    await editCell(user, "D2", "North");

    await waitFor(() => expect(redoButton().disabled).toBe(true));
    await user.keyboard("{Control>}y{/Control}");
    expect(gridCell("D1").textContent).toBe("");
    expect(gridCell("D2").textContent).toBe("North");
    expect(worksheet().cells.D1).toBeUndefined();
    expect(worksheet().cells.D2).toBe("North");
  });

  it("undoes a range move, restoring both the source and the target", async () => {
    const { user } = await openEditor();

    // Copy through the cell menu, then move the range with Ctrl+V.
    fireEvent.contextMenu(gridCell("A1"));
    const menu = await screen.findByRole("menu", { name: "Cell A1 menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Cut" }));
    await user.click(gridCell("D1"));
    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("Region"));
    expect(gridCell("A1").textContent).toBe("");

    await user.click(undoButton());

    await waitFor(() => expect(gridCell("A1").textContent).toBe("Region"));
    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet().cells.A1).toBe("Region");
    expect(worksheet().cells.D1).toBeUndefined();
  });

  it("undoes a row insertion and restores the shifted rows", async () => {
    const { user } = await openEditor();

    await editCell(user, "D1", "900");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("900"));

    const header = within(grid()).getByRole("rowheader", { name: "1" });
    fireEvent.contextMenu(header);
    const menu = await screen.findByRole("menu", { name: "Row 1 menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    await waitFor(() => expect(worksheet().cells.D2).toBe("900"));
    expect(worksheet().rowCount).toBe(13);
    expect(gridCell("A1").textContent).toBe("");

    await user.click(undoButton());

    await waitFor(() => expect(worksheet().cells.D1).toBe("900"));
    expect(worksheet().rowCount).toBe(12);
    expect(gridCell("A1").textContent).toBe("Region");
    expect(gridCell("D1").textContent).toBe("900");
    expect(worksheet().cells.D2).toBeUndefined();
  });
});
