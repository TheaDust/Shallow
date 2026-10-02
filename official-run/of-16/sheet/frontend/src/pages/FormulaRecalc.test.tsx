import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookEditorPage } from "./WorkbookEditorPage";
import { installFakeBackend, type FakeBackend } from "../test/fake-backend";

/**
 * Dependency recalculation of the seeded `Q3 Sales` workbook (REQ-4-2-1) and
 * formula copies that adjust their relative references (REQ-4-1-2). The formula
 * seed lives on `Sheet2`: A1=2, B1=3, C1=`=A1+B1` (5) and the directly
 * dependent D1=`=C1*2` (10).
 */

const SHEET2_TAB = "Sheet2";

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function formulaBar(): HTMLElement {
  return screen.getByRole("textbox", { name: "Formula bar" });
}

function cellText(name: string): string {
  return screen.getByRole("gridcell", { name }).textContent ?? "";
}

function toolbarButton(name: string): HTMLElement {
  return within(screen.getByRole("toolbar")).getByRole("button", { name });
}

/** Ctrl+C / Ctrl+X on the grid; returns the text offered to the system clipboard. */
function pressTransfer(key: "copy" | "cut"): string {
  let text = "";
  fireEvent[key](grid(), {
    clipboardData: {
      setData: (_type: string, value: string) => { text = value; },
      getData: () => text,
    },
  });
  return text;
}

/** Ctrl+V on the grid with the given clipboard text. */
function pressPaste(text: string): void {
  fireEvent.paste(grid(), { clipboardData: { getData: () => text } });
}

/** Selects one cell and submits `text` through the formula bar (Enter commits). */
async function submitFormula(
  user: ReturnType<typeof userEvent.setup>,
  cell: string,
  text: string,
): Promise<void> {
  await user.click(screen.getByRole("gridcell", { name: cell }));
  const bar = formulaBar();
  await user.clear(bar);
  await user.type(bar, `${text}{Enter}`);
}

async function openSheet2(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("tab", { name: SHEET2_TAB }));
  await screen.findByRole("gridcell", { name: "A1" });
}

describe("dependent formula recalculation", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend();
    vi.stubGlobal("fetch", backend.fetch);
    window.location.hash = "#/workbooks/q3-sales";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("recalculates directly and indirectly dependent formulas after a bulk paste changes their sources", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);

    expect(cellText("C1")).toBe("5");
    expect(cellText("D1")).toBe("10");

    // One paste overwrites both source cells of `=A1+B1`.
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    pressPaste("10\t4");

    await waitFor(() => expect(cellText("C1")).toBe("14"));
    expect(cellText("A1")).toBe("10");
    expect(cellText("B1")).toBe("4");
    // The indirectly dependent formula follows the same new sources.
    expect(cellText("D1")).toBe("28");

    // Every formula bar keeps the original submitted expression, not the result.
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(formulaBar()).toHaveProperty("value", "=A1+B1");
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect(formulaBar()).toHaveProperty("value", "=C1*2");

    // The other worksheet of the workbook keeps its own seeded values.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    expect(cellText("A1")).toBe("Region");
    expect(cellText("B2")).toBe("1200");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("A1")).toBe("10");
    expect(cellText("C1")).toBe("14");
    expect(cellText("D1")).toBe("28");
    await user.click(screen.getByRole("gridcell", { name: "D1" }));
    expect(formulaBar()).toHaveProperty("value", "=C1*2");
  });

  it("recalculates dependents after a range move empties their source cell", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);

    // Move the source value A1 to A3: the moved cell keeps its value and the
    // formulas that referenced A1 now read the emptied source.
    await user.click(screen.getByRole("gridcell", { name: "A1" }));
    await user.click(toolbarButton("Cut"));
    await user.click(screen.getByRole("gridcell", { name: "A3" }));
    await user.click(toolbarButton("Paste"));

    await waitFor(() => expect(cellText("A3")).toBe("2"));
    expect(cellText("A1")).toBe("");
    await waitFor(() => expect(cellText("C1")).toBe("3"));
    expect(cellText("D1")).toBe("6");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(formulaBar()).toHaveProperty("value", "=A1+B1");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("C1")).toBe("3");
    expect(cellText("D1")).toBe("6");
  });

  it("recalculates dependents after a row insert and a row delete, and keeps them after reopening", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);

    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));

    // The records and their formulas shift down together; the shifted formulas
    // keep adjusted references and still show the results of the moved sources.
    await waitFor(() => expect(cellText("C2")).toBe("5"));
    expect(cellText("A2")).toBe("2");
    expect(cellText("B2")).toBe("3");
    expect(cellText("D2")).toBe("10");
    await user.click(screen.getByRole("gridcell", { name: "C2" }));
    expect(formulaBar()).toHaveProperty("value", "=A2+B2");
    await user.click(screen.getByRole("gridcell", { name: "D2" }));
    expect(formulaBar()).toHaveProperty("value", "=C2*2");
    expect(backend.workbooks[0].worksheets[1].cells.C2).toBe("=A2+B2");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("C2")).toBe("5");
    expect(cellText("D2")).toBe("10");

    // Deleting the inserted blank row pulls everything back with its references.
    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete row" }));
    await waitFor(() => expect(cellText("C1")).toBe("5"));
    expect(cellText("A1")).toBe("2");
    expect(cellText("D1")).toBe("10");
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(formulaBar()).toHaveProperty("value", "=A1+B1");
  });

  it("reports an explicit error in the formulas a deleted column breaks and leaves other cells working", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "C" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete column" }));

    // D1 moved left and lost its direct reference to the deleted column.
    await waitFor(() => expect(cellText("C1")).toBe("#REF!"));
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    expect(formulaBar()).toHaveProperty("value", "=#REF!*2");
    // The source values and the cells unrelated to the error keep their results.
    expect(cellText("A1")).toBe("2");
    expect(cellText("B1")).toBe("3");
    expect(backend.workbooks[0].worksheets[1].cells.C1).toBe("=#REF!*2");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("C1")).toBe("#REF!");
  });

  it("shows =#REF! in the target formula bar when a copied relative reference leaves the sheet", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);

    // Copying the seeded `=A1+B1` one column left pushes its first reference
    // before column A, so the target formula becomes exactly `=#REF!`.
    await user.click(screen.getByRole("gridcell", { name: "C1" }));
    await user.click(toolbarButton("Copy"));
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    await user.click(toolbarButton("Paste"));

    await waitFor(() => expect(cellText("B2")).toBe("#REF!"));
    expect(formulaBar()).toHaveProperty("value", "=#REF!");
    expect(backend.workbooks[0].worksheets[1].cells.B2).toBe("=#REF!");
    // The source formula and result stay as they were, and the cells unrelated
    // to the error keep calculating.
    expect(cellText("C1")).toBe("5");
    expect(cellText("D1")).toBe("10");

    // A formula that is only a relative reference leaves the sheet the same way.
    await submitFormula(user, "B4", "=A1");
    await waitFor(() => expect(cellText("B4")).toBe("2"));
    await user.click(screen.getByRole("gridcell", { name: "B4" }));
    await user.click(toolbarButton("Copy"));
    await user.click(screen.getByRole("gridcell", { name: "B3" }));
    await user.click(toolbarButton("Paste"));
    await waitFor(() => expect(cellText("B3")).toBe("#REF!"));
    expect(formulaBar()).toHaveProperty("value", "=#REF!");
    // The source cell keeps its own formula and result.
    expect(cellText("B4")).toBe("2");
    await user.click(screen.getByRole("gridcell", { name: "B4" }));
    expect(formulaBar()).toHaveProperty("value", "=A1");

    view.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("B2")).toBe("#REF!");
    await user.click(screen.getByRole("gridcell", { name: "B2" }));
    expect(formulaBar()).toHaveProperty("value", "=#REF!");
    expect(cellText("C1")).toBe("5");
    expect(cellText("D1")).toBe("10");
  });

  it("shows #REF! for a reference outside the sheet and lets that cell be fixed and reloaded", async () => {
    const user = userEvent.setup();
    const view = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);

    // A coordinate beyond the worksheet's rows/columns is an invalid reference,
    // not a blank cell that reads as 0; the formula bar keeps the submitted text.
    await submitFormula(user, "E1", "=ZZZ99999");
    await waitFor(() => expect(cellText("E1")).toBe("#REF!"));
    expect(formulaBar()).toHaveProperty("value", "=ZZZ99999");
    // One error cell does not block the cells unrelated to it.
    expect(cellText("C1")).toBe("5");
    expect(cellText("D1")).toBe("10");
    expect(backend.workbooks[0].worksheets[1].cells.E1).toBe("=ZZZ99999");

    view.unmount();
    const reloaded = render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("E1")).toBe("#REF!");
    await user.click(screen.getByRole("gridcell", { name: "E1" }));
    expect(formulaBar()).toHaveProperty("value", "=ZZZ99999");

    // Replacing the error with a valid formula clears it and shows the result.
    await submitFormula(user, "E1", "=C1+1");
    await waitFor(() => expect(cellText("E1")).toBe("6"));
    expect(formulaBar()).toHaveProperty("value", "=C1+1");

    reloaded.unmount();
    render(<WorkbookEditorPage workbookId="q3-sales" />);
    await openSheet2(user);
    expect(cellText("E1")).toBe("6");
    expect(screen.queryByText("#REF!")).toBeNull();
  });
});
