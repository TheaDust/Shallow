import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { installFakeBackend } from "../test/fake-backend";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "#/";
});

type Harness = ReturnType<typeof installFakeBackend>;

async function openSeededEditor() {
  window.location.hash = "#/";
  const backend = installFakeBackend();
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy());
  return { ...backend, user };
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cell(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate });
}

function value(coordinate: string) {
  return cell(coordinate).textContent;
}

function formulaBar(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement;
}

/** Types a value into one cell through the grid's own inline editor. */
async function typeInCell(user: ReturnType<typeof userEvent.setup>, coordinate: string, text: string) {
  await user.click(cell(coordinate));
  await user.keyboard(`${text}{Enter}`);
}

/** Types a value into the selected cell through the formula bar. */
async function typeInFormulaBar(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.clear(formulaBar());
  await user.type(formulaBar(), `${text}{Enter}`);
}

/** Re-renders the application from a fresh mount against the same fake backend state. */
function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function clipboardStandIn() {
  const stored: Record<string, string> = {};
  return {
    stored,
    data: {
      setData: (type: string, text: string) => { stored[type] = text; },
      getData: (type: string) => stored[type] ?? "",
    },
  };
}

/** Copies the selected cell and pastes it onto `target` through the in-application rectangle. */
async function copyCellOnto(
  user: ReturnType<typeof userEvent.setup>,
  source: string,
  target: string,
) {
  await user.click(cell(source));
  const clipboard = clipboardStandIn();
  fireEvent.copy(grid(), { clipboardData: clipboard.data });
  await user.click(cell(target));
  fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });
}

describe("formula calculation", () => {
  it("shows the result in the grid and the original expression in the formula bar", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    // Entered through the grid's inline editor.
    await typeInCell(user, "C1", "=B2+B3");
    await waitFor(() => expect(value("C1")).toBe("2000"));
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=B2+B3");

    // Entered through the formula bar; function names are case-insensitive.
    await user.click(cell("C2"));
    await typeInFormulaBar(user, "=sum(b2:b3)*2");
    await waitFor(() => expect(value("C2")).toBe("4000"));
    expect(formulaBar().value).toBe("=sum(b2:b3)*2");
  });

  it("calculates SUM, AVERAGE, COUNT, MIN and MAX over a contiguous range and follows a source edit", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=SUM(B2:B3)");
    await user.click(cell("C2"));
    await typeInFormulaBar(user, "=AVERAGE(B2:B3)");
    await user.click(cell("C3"));
    await typeInFormulaBar(user, "=COUNT(B2:B3)");
    await user.click(cell("C4"));
    await typeInFormulaBar(user, "=MIN(B2:B3)");
    await user.click(cell("C5"));
    await typeInFormulaBar(user, "=MAX(B2:B3)");

    await waitFor(() => expect(value("C1")).toBe("2000"));
    expect(value("C2")).toBe("1000");
    expect(value("C3")).toBe("2");
    expect(value("C4")).toBe("800");
    expect(value("C5")).toBe("1200");

    // Editing a source value recalculates every dependent aggregate.
    await user.click(cell("B2"));
    await typeInFormulaBar(user, "1500");
    await waitFor(() => expect(value("C1")).toBe("2300"));
    expect(value("C2")).toBe("1150");
    expect(value("C3")).toBe("2");
    expect(value("C4")).toBe("800");
    expect(value("C5")).toBe("1500");

    await reopenEditor(backend);
    await waitFor(() => expect(value("B2")).toBe("1500"));
    expect(value("C1")).toBe("2300");
    expect(value("C2")).toBe("1150");
    await user.click(await within(grid()).findByRole("gridcell", { name: "C1" }));
    expect(formulaBar().value).toBe("=SUM(B2:B3)");
  });

  it("ignores empty and text cells instead of treating them as zero", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("A1"));
    await typeInFormulaBar(user, "note");
    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=SUM(A1:A3)");
    await user.click(cell("C2"));
    await typeInFormulaBar(user, "=COUNT(A1:A3)");
    await user.click(cell("C3"));
    await typeInFormulaBar(user, "=AVERAGE(A1:A3)");

    await waitFor(() => expect(value("C1")).toBe("0"));
    expect(value("C2")).toBe("0");
    // A single text cell is not a number, so there is nothing to average.
    expect(value("C3")).toBe("#DIV/0!");
  });

  it("recalculates the dependents of a pasted source value", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=B2*2");
    await waitFor(() => expect(value("C1")).toBe("2400"));

    // A plain-text paste overwrites the source column: the dependents follow the new values.
    await user.click(cell("B2"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "1500\n2000" } });
    await waitFor(() => expect(value("B2")).toBe("1500"));
    expect(value("B3")).toBe("2000");
    expect(value("C1")).toBe("3000");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C1")).toBe("3000"));
    expect(value("B2")).toBe("1500");
  });

  it("recalculates direct and indirect dependents in one step and keeps them after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=B2*2");
    await user.click(cell("D1"));
    await typeInFormulaBar(user, "=C1+B3");
    await user.click(cell("E1"));
    await typeInFormulaBar(user, "=$B$2-B3");

    await waitFor(() => expect(value("D1")).toBe("3200"));
    expect(value("E1")).toBe("400");

    await user.click(cell("B2"));
    await typeInFormulaBar(user, "1500");
    await waitFor(() => expect(value("C1")).toBe("3000"));
    expect(value("D1")).toBe("3800");
    // The `$`-pinned reference follows the same new source value.
    expect(value("E1")).toBe("700");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C1")).toBe("3000"));
    expect(value("D1")).toBe("3800");
    expect(value("E1")).toBe("700");
    await user.click(await within(grid()).findByRole("gridcell", { name: "E1" }));
    expect(formulaBar().value).toBe("=$B$2-B3");
  });
});

/** Sets the content of one cell through the formula bar, the way the editor exposes it. */
async function setCell(user: ReturnType<typeof userEvent.setup>, coordinate: string, text: string) {
  await user.click(cell(coordinate));
  await typeInFormulaBar(user, text);
}

/** Runs one command of the row-number menu opened on the given row header. */
async function rowMenu(user: ReturnType<typeof userEvent.setup>, row: number, command: string) {
  fireEvent.contextMenu(screen.getByRole("rowheader", { name: String(row) }));
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: command }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

/** Cuts the selected cell and pastes it onto `target` through the in-application rectangle. */
async function cutCellOnto(
  user: ReturnType<typeof userEvent.setup>,
  source: string,
  target: string,
) {
  await user.click(cell(source));
  const clipboard = clipboardStandIn();
  fireEvent.cut(grid(), { clipboardData: clipboard.data });
  await user.click(cell(target));
  fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });
}

describe("dependency recalculation after source changes", () => {
  it("recalculates a chain after a row insertion and keeps the adjusted formulas after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await setCell(user, "A1", "2");
    await setCell(user, "B1", "3");
    await setCell(user, "C1", "=A1+B1");
    await setCell(user, "D1", "=C1*2");
    await waitFor(() => expect(value("C1")).toBe("5"));
    expect(value("D1")).toBe("10");

    // The row-number menu moves the whole chain down and rewrites its references with it.
    await rowMenu(user, 1, "Insert 1 row above");
    await waitFor(() => expect(value("C2")).toBe("5"));
    expect(value("D2")).toBe("10");
    expect(value("A2")).toBe("2");
    expect(value("C1")).toBe("");
    await user.click(cell("C2"));
    expect(formulaBar().value).toBe("=A2+B2");
    await user.click(cell("D2"));
    expect(formulaBar().value).toBe("=C2*2");

    // A source edit recalculates the direct and the indirect dependent.
    await setCell(user, "A2", "10");
    await waitFor(() => expect(value("C2")).toBe("13"));
    expect(value("D2")).toBe("26");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C2")).toBe("13"));
    expect(value("D2")).toBe("26");
    await user.click(await within(grid()).findByRole("gridcell", { name: "C2" }));
    expect(formulaBar().value).toBe("=A2+B2");
  });

  it("recalculates the dependents of a moved source value and keeps them after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await setCell(user, "A1", "2");
    await setCell(user, "B1", "3");
    await setCell(user, "C1", "=A1+B1");
    await setCell(user, "D1", "=C1*2");
    await waitFor(() => expect(value("C1")).toBe("5"));

    await cutCellOnto(user, "B1", "B5");
    await waitFor(() => expect(value("B5")).toBe("3"));
    expect(value("B1")).toBe("");
    // The results follow the source cells the formulas read now, directly and indirectly.
    expect(value("C1")).toBe("2");
    expect(value("D1")).toBe("4");
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=A1+B1");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C1")).toBe("2"));
    expect(value("D1")).toBe("4");
    expect(value("B5")).toBe("3");
  });

  it("isolates the error a deleted row creates and keeps unrelated formulas working", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await setCell(user, "C1", "=B2+B3");
    await setCell(user, "D1", "=C1*2");
    await setCell(user, "E1", "=1+1");
    await waitFor(() => expect(value("C1")).toBe("2000"));
    expect(value("D1")).toBe("4000");

    await rowMenu(user, 3, "Delete row");
    await waitFor(() => expect(value("C1")).toBe("#REF!"));
    // The dependent of the broken formula follows it; the unrelated cell does not.
    expect(value("D1")).toBe("#REF!");
    expect(value("E1")).toBe("2");
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=B2+#REF!");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C1")).toBe("#REF!"));
    expect(value("D1")).toBe("#REF!");
    expect(value("E1")).toBe("2");
  });

  it("leaves the formulas of another worksheet unchanged", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(value("A1")).toBe(""));
    await setCell(user, "A1", "4");
    await setCell(user, "A2", "=A1*3");
    await waitFor(() => expect(value("A2")).toBe("12"));

    // Editing the other worksheet changes its own results only.
    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(value("A2")).toBe("East"));
    await setCell(user, "A1", "100");
    await waitFor(() => expect(value("A1")).toBe("100"));

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(value("A2")).toBe("12"));
    await user.click(cell("A2"));
    expect(formulaBar().value).toBe("=A1*3");

    await reopenEditor(backend);
    await waitFor(() => expect(value("A2")).toBe("12"));
    await user.click(await within(grid()).findByRole("gridcell", { name: "A2" }));
    expect(formulaBar().value).toBe("=A1*3");
  });
});

describe("formula errors", () => {
  it("shows the documented error values and keeps unrelated cells recalculating", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=1/0");
    await user.click(cell("C2"));
    await typeInFormulaBar(user, "=NOPE(1)");
    await user.click(cell("C3"));
    await typeInFormulaBar(user, "=1+");
    await user.click(cell("C4"));
    await typeInFormulaBar(user, "=A0");
    await user.click(cell("C5"));
    await typeInFormulaBar(user, "=C5");
    await user.click(cell("D1"));
    await typeInFormulaBar(user, "=B2/2");

    await waitFor(() => expect(value("C1")).toBe("#DIV/0!"));
    expect(value("C2")).toBe("#NAME?");
    expect(value("C3")).toBe("#ERROR!");
    expect(value("C4")).toBe("#REF!");
    expect(value("C5")).toBe("#REF!");
    // One broken formula never blocks another cell.
    expect(value("D1")).toBe("600");

    // A selected error cell keeps showing the expression the user submitted.
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=1/0");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C1")).toBe("#DIV/0!"));
    expect(value("C2")).toBe("#NAME?");
    expect(value("C3")).toBe("#ERROR!");
    expect(value("C4")).toBe("#REF!");
    expect(value("C5")).toBe("#REF!");
    expect(value("D1")).toBe("600");
    await user.click(await within(grid()).findByRole("gridcell", { name: "C1" }));
    expect(formulaBar().value).toBe("=1/0");
  });

  it("replaces an error with a valid formula and recalculates the dependents", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=B2/0");
    await user.click(cell("C2"));
    await typeInFormulaBar(user, "=C1*2");
    await waitFor(() => expect(value("C2")).toBe("#DIV/0!"));

    // Editing the broken cell through the grid repairs it.
    await typeInCell(user, "C1", "=B2/4");
    await waitFor(() => expect(value("C1")).toBe("300"));
    expect(value("C2")).toBe("600");
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=B2/4");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C1")).toBe("300"));
    expect(value("C2")).toBe("600");
    expect(screen.queryByText("#DIV/0!")).toBeNull();
  });
});

describe("copying formulas", () => {
  it("adjusts the copied references by the target offset and keeps the source untouched", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("C1"));
    await typeInFormulaBar(user, "=B2+$B$2");
    await waitFor(() => expect(value("C1")).toBe("2400"));

    await copyCellOnto(user, "C1", "C2");
    await waitFor(() => expect(value("C2")).toBe("2000"));
    // The target shows the rewritten expression, the source keeps its own.
    await user.click(cell("C2"));
    expect(formulaBar().value).toBe("=B3+$B$2");
    await user.click(cell("C1"));
    expect(formulaBar().value).toBe("=B2+$B$2");
    expect(value("C1")).toBe("2400");

    await reopenEditor(backend);
    await waitFor(() => expect(value("C2")).toBe("2000"));
    expect(value("C1")).toBe("2400");
    await user.click(await within(grid()).findByRole("gridcell", { name: "C2" }));
    expect(formulaBar().value).toBe("=B3+$B$2");
  });

  it("shows =#REF! in the target formula bar when the offset leaves the worksheet", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("B1"));
    await typeInFormulaBar(user, "=A2");
    await waitFor(() => expect(value("B1")).toBe("East"));

    // Copying B1 onto A1 moves the relative column A reference one column past the left edge.
    await copyCellOnto(user, "B1", "A1");
    await waitFor(() => expect(value("A1")).toBe("#REF!"));
    await user.click(cell("A1"));
    expect(formulaBar().value).toBe("=#REF!");

    // The source formula and its result stay unchanged.
    await user.click(cell("B1"));
    expect(formulaBar().value).toBe("=A2");
    expect(value("B1")).toBe("East");

    await reopenEditor(backend);
    await waitFor(() => expect(value("A1")).toBe("#REF!"));
    await user.click(await within(grid()).findByRole("gridcell", { name: "A1" }));
    expect(formulaBar().value).toBe("=#REF!");
    expect(value("B1")).toBe("East");
  });
});
