import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { createMockBackend, seedWorkbook } from "../../test/mock-backend";
import type { ValidationRule } from "../../domain/types";

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

function worksheet(index = 0) {
  return backend.workbooks[0].worksheets[index];
}

async function commitFormulaBar(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.clear(formulaBar());
  await user.type(formulaBar(), text);
  await user.keyboard("{Enter}");
}

describe("editing through the grid", () => {
  it("opens an inline text box named 'Edit <coordinate>' on double click and commits with Enter", async () => {
    const { user } = await openEditor();
    const target = gridCell("D1");

    await user.dblClick(target);

    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    expect(target.contains(editor)).toBe(true);
    expect((editor as HTMLInputElement).value).toBe("");

    await user.type(editor, "East");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(gridCell("D1").textContent).toBe("East"));
    expect(screen.queryByRole("textbox", { name: "Edit D1" })).toBeNull();
    expect(worksheet().cells.D1).toBe("East");
    expect(worksheet().cells.A1).toBe("Region");
  });

  it("starts editing from the keyboard and commits by clicking another cell", async () => {
    const { user } = await openEditor();
    await user.click(gridCell("D1"));

    await user.keyboard("East");
    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    expect((editor as HTMLInputElement).value).toBe("East");

    await user.click(gridCell("E1"));

    await waitFor(() => expect(gridCell("D1").textContent).toBe("East"));
    expect(gridCell("E1").getAttribute("aria-selected")).toBe("true");
    expect(gridCell("D1").getAttribute("aria-selected")).toBe("false");
    expect(worksheet().cells.D1).toBe("East");
    expect(worksheet().cells.E1).toBeUndefined();
  });

  it("cancels an uncommitted grid change with Escape", async () => {
    const { user } = await openEditor();
    await user.dblClick(gridCell("D1"));
    const editor = await screen.findByRole("textbox", { name: "Edit D1" });

    await user.type(editor, "Ignored");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit D1" })).toBeNull());
    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet().cells.D1).toBeUndefined();
  });

  it("keeps ordinary values and original formulas consistent between grid and formula bar", async () => {
    const { user } = await openEditor();

    await user.click(gridCell("D1"));
    expect(formulaBar().value).toBe("");
    await commitFormulaBar(user, "East");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("East"));

    await user.click(gridCell("E1"));
    await commitFormulaBar(user, "1200");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("1200"));

    await user.click(gridCell("D1"));
    expect(formulaBar().value).toBe("East");
    await user.click(gridCell("E1"));
    expect(formulaBar().value).toBe("1200");
    expect(worksheet().cells.D1).toBe("East");
    expect(worksheet().cells.E1).toBe("1200");
  });

  it("cancels an uncommitted formula bar change with Escape", async () => {
    const { user } = await openEditor();
    await user.click(gridCell("D1"));

    await user.type(formulaBar(), "Ignored");
    expect(formulaBar().value).toBe("Ignored");
    await user.keyboard("{Escape}");

    expect(formulaBar().value).toBe("");
    expect(gridCell("D1").textContent).toBe("");
    expect(worksheet().cells.D1).toBeUndefined();
  });

  it("commits a formula bar change with Enter", async () => {
    const { user } = await openEditor();
    await user.click(gridCell("D1"));
    await commitFormulaBar(user, "1200");

    await waitFor(() => expect(gridCell("D1").textContent).toBe("1200"));
    expect(formulaBar().value).toBe("1200");
    expect(worksheet().cells.D1).toBe("1200");
  });

  it("clears the selected cell with Delete", async () => {
    const { user } = await openEditor();
    await user.click(gridCell("A2"));
    expect(gridCell("A2").textContent).toBe("East");

    await user.keyboard("{Delete}");

    await waitFor(() => expect(gridCell("A2").textContent).toBe(""));
    expect(worksheet().cells.A2).toBeUndefined();
    expect(worksheet().cells.B2).toBe("1200");
  });
});

describe("formula cells", () => {
  it("shows the calculated result in the grid and the submitted formula in the formula bar", async () => {
    const { user } = await openEditor();

    await user.click(gridCell("D1"));
    await commitFormulaBar(user, "=B2+B3");

    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));
    expect(formulaBar().value).toBe("=B2+B3");
    expect(worksheet().cells.D1).toBe("=B2+B3");
  });

  it("recalculates directly and indirectly dependent formulas and persists them after reopen", async () => {
    const { user, view } = await openEditor();

    await user.click(gridCell("D1"));
    await commitFormulaBar(user, "=B2+B3");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("2000"));

    await user.click(gridCell("E1"));
    await commitFormulaBar(user, "=D1*2");
    await waitFor(() => expect(gridCell("E1").textContent).toBe("4000"));

    await user.click(gridCell("B2"));
    await commitFormulaBar(user, "100");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("900"));
    expect(gridCell("E1").textContent).toBe("1800");
    expect(gridCell("B2").textContent).toBe("100");
    expect(worksheet().cells.B2).toBe("100");

    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });

    expect(gridCell("D1").textContent).toBe("900");
    expect(gridCell("E1").textContent).toBe("1800");
    await userEvent.setup().click(gridCell("D1"));
    expect(formulaBar().value).toBe("=B2+B3");
    expect(gridCell("B2").textContent).toBe("100");
  });
});

describe("failed commits", () => {
  it("shows the validation error and keeps the last successful value everywhere", async () => {
    backend.workbooks[0].worksheets[0].validations = [
      {
        id: "rule-d1",
        type: "numeric",
        min: 0,
        max: 100,
        range: { minRow: 0, maxRow: 0, minCol: 3, maxCol: 3 },
      },
    ] satisfies ValidationRule[];
    const { user } = await openEditor();

    await user.click(gridCell("D1"));
    await commitFormulaBar(user, "50");
    await waitFor(() => expect(gridCell("D1").textContent).toBe("50"));

    await user.dblClick(gridCell("D1"));
    const editor = await screen.findByRole("textbox", { name: "Edit D1" });
    await user.clear(editor);
    await user.type(editor, "101");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Please enter a number from 0 to 100"),
    );
    expect(gridCell("D1").textContent).toBe("50");
    expect(formulaBar().value).toBe("50");
    expect(worksheet().cells.D1).toBe("50");
    expect(worksheet(1).cells).toEqual({});
  });
});
