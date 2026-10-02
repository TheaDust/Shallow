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

function isDisabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

/** Re-renders the application from a fresh mount against the same fake backend state. */
function reopenEditor(backend: Harness) {
  cleanup();
  backend.install();
  window.location.hash = "#/workbooks/wb-q3-sales";
  render(<App />);
  return screen.findByRole("grid", { name: "Worksheet grid" });
}

function selectRectangle(start: string, end: string) {
  fireEvent.mouseDown(cell(start), { button: 0, clientX: 10, clientY: 10 });
  fireEvent.mouseMove(cell(end), { clientX: 60, clientY: 40 });
  fireEvent.mouseUp(cell(end));
}

/** A clipboard stand-in whose `setData` records what the application copied. */
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

function useClipboard(readText: (() => Promise<string>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: readText ? { readText, writeText: async () => undefined } : undefined,
  });
}

function transferRequests(backend: Harness) {
  return backend.requests.filter((request) => request.path.endsWith("/range-transfer"));
}

describe("copying and cutting a cell range", () => {
  it("copies A1:B2 onto D1:E2 through Ctrl+C and Ctrl+V, keeping the source", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A1", "B2");
    await waitFor(() => expect(cell("B2").getAttribute("aria-selected")).toBe("true"));
    const clipboard = clipboardStandIn();
    fireEvent.copy(grid(), { clipboardData: clipboard.data });
    expect(clipboard.stored["text/plain"]).toBe("Region\tSales\nEast\t1200");

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });

    await waitFor(() => expect(value("E2")).toBe("1200"));
    expect(value("D1")).toBe("Region");
    expect(value("E1")).toBe("Sales");
    expect(value("D2")).toBe("East");
    // A copy never changes the source range nor any cell outside the target.
    expect(value("A1")).toBe("Region");
    expect(value("B2")).toBe("1200");
    // Cells outside both rectangles keep their value.
    expect(value("C1")).toBe("Status");
    expect(value("D3")).toBe("");
    // The rectangle is transferred through the range endpoint, not as plain pasted text.
    expect(transferRequests(backend)).toHaveLength(1);

    await reopenEditor(backend);
    expect(value("D1")).toBe("Region");
    expect(value("E2")).toBe("1200");
    expect(value("A1")).toBe("Region");
  });

  it("keeps the source until the cut is pasted, then clears it completely", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    selectRectangle("A2", "B2");
    await waitFor(() => expect(cell("B2").getAttribute("aria-selected")).toBe("true"));

    // The context menu offers Cut, Copy and Paste for a cell of the selected rectangle.
    fireEvent.contextMenu(cell("A2"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Cut", "Copy", "Paste"]);
    const clipboard = clipboardStandIn();
    fireEvent.cut(grid(), { clipboardData: clipboard.data });
    expect(clipboard.stored["text/plain"]).toBe("East\t1200");
    // Cutting alone changes nothing: the source is only cleared by the paste.
    expect(value("A2")).toBe("East");

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });

    await waitFor(() => expect(value("E1")).toBe("1200"));
    expect(value("D1")).toBe("East");
    expect(value("A2")).toBe("");
    expect(value("B2")).toBe("");
    expect(value("A1")).toBe("Region");

    await reopenEditor(backend);
    expect(value("D1")).toBe("East");
    expect(value("E1")).toBe("1200");
    expect(value("A2")).toBe("");
  });

  it("pastes the copied rectangle through the Paste command of the context menu", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("A1"));
    fireEvent.contextMenu(cell("A1"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy" }));

    const copied = "Region\tSales\nEast\t1200";
    useClipboard(async () => copied);
    await user.click(cell("D1"));
    fireEvent.contextMenu(cell("D1"));
    await user.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() => expect(value("E2")).toBe("1200"));
    expect(value("D2")).toBe("East");
    expect(value("A1")).toBe("Region");
  });

  it("adjusts relative references of a copied formula and keeps absolute ones", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    const formulaBar = () => (screen.getByRole("textbox", { name: "Formula bar" }) as HTMLInputElement).value;

    await user.click(cell("C1"));
    await user.keyboard("=B2+$B$2{Enter}");
    // The grid shows the result of the expression, the formula bar the submitted formula.
    await waitFor(() => expect(value("C1")).toBe("2400"));
    expect(formulaBar()).toBe("=B2+$B$2");

    await user.click(cell("C1"));
    const clipboard = clipboardStandIn();
    fireEvent.copy(grid(), { clipboardData: clipboard.data });
    await user.click(cell("C2"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });

    // The copied formula follows the target offset: rows move, the `$`-pinned row stays.
    await waitFor(() => expect(value("C2")).toBe("2000"));
    // The formula bar shows the adjusted original formula of the selected cell.
    expect(formulaBar()).toBe("=B3+$B$2");

    await user.click(cell("C1"));
    expect(formulaBar()).toBe("=B2+$B$2");
    expect(value("C1")).toBe("2400");
  });

  it("shows the rejection message and keeps source and target when the transfer is refused", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    backend.failNextRequest((_method, path) => path.endsWith("/range-transfer"), {
      status: 400,
      error: "Please enter a number from 0 to 100",
    });

    selectRectangle("A1", "B2");
    await waitFor(() => expect(cell("B2").getAttribute("aria-selected")).toBe("true"));
    const clipboard = clipboardStandIn();
    fireEvent.copy(grid(), { clipboardData: clipboard.data });
    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });

    expect(await screen.findByText("Please enter a number from 0 to 100")).toBeTruthy();
    expect(value("D1")).toBe("");
    expect(value("E2")).toBe("");
    expect(value("A1")).toBe("Region");
    expect(value("B2")).toBe("1200");
  });

  it("pastes an external table as plain text, without a copied rectangle", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => "East\t1200\nNorth\t800" } });

    await waitFor(() => expect(value("E2")).toBe("800"));
    expect(value("D1")).toBe("East");
    expect(transferRequests(backend)).toHaveLength(0);
  });
});

describe("undo and redo of recent operations", () => {
  it("undoes and redoes a cell edit from the toolbar buttons and keeps the result after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    expect(isDisabled("Undo")).toBe(true);
    expect(isDisabled("Redo")).toBe(true);

    await user.click(cell("A2"));
    await user.keyboard("West{Enter}");
    await waitFor(() => expect(value("A2")).toBe("West"));
    expect(isDisabled("Undo")).toBe(false);
    expect(isDisabled("Redo")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(value("A2")).toBe("East"));
    expect(isDisabled("Redo")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(value("A2")).toBe("West"));
    expect(isDisabled("Redo")).toBe(true);

    await reopenEditor(backend);
    expect(value("A2")).toBe("West");
  });

  it("performs the same operations with Ctrl+Z and Ctrl+Y in reverse order", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("A2"));
    await user.keyboard("West{Enter}");
    await waitFor(() => expect(value("A2")).toBe("West"));
    await user.click(cell("B2"));
    await user.keyboard("1500{Enter}");
    await waitFor(() => expect(value("B2")).toBe("1500"));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(value("B2")).toBe("1200"));
    expect(value("A2")).toBe("West");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(value("A2")).toBe("East"));

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(value("A2")).toBe("West"));
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(value("B2")).toBe("1500"));
  });

  it("disables redo again as soon as a new modification is made", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(cell("A2"));
    await user.keyboard("West{Enter}");
    await waitFor(() => expect(value("A2")).toBe("West"));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(value("A2")).toBe("East"));
    expect(isDisabled("Redo")).toBe(false);

    await user.click(cell("C4"));
    await user.keyboard("New{Enter}");
    await waitFor(() => expect(value("C4")).toBe("New"));
    expect(isDisabled("Redo")).toBe(true);

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(value("A2")).toBe("East");
    expect(value("C4")).toBe("New");
  });

  it("restores grid values, structure and copied ranges together", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    // A row insert is undone as one operation.
    fireEvent.contextMenu(screen.getByRole("rowheader", { name: "2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert 1 row above" }));
    await waitFor(() => expect(value("A3")).toBe("East"));
    expect(value("A2")).toBe("");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(value("A2")).toBe("East"));
    expect(value("A3")).toBe("North");

    // A range move restores both the cleared source and the written target.
    selectRectangle("A1", "B2");
    await waitFor(() => expect(cell("B2").getAttribute("aria-selected")).toBe("true"));
    const clipboard = clipboardStandIn();
    fireEvent.cut(grid(), { clipboardData: clipboard.data });
    await user.click(cell("D1"));
    fireEvent.paste(grid(), { clipboardData: { getData: () => clipboard.stored["text/plain"] } });
    await waitFor(() => expect(value("D2")).toBe("East"));
    expect(value("A1")).toBe("");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(value("A1")).toBe("Region"));
    expect(value("D1")).toBe("");
    expect(value("D2")).toBe("");

    await user.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(value("D1")).toBe("Region"));
    expect(value("A1")).toBe("");
  });
});
