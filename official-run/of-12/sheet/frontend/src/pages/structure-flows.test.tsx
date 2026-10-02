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

async function openSeededEditor() {
  window.location.hash = "#/";
  const backend = installFakeBackend();
  const view = render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));
  await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
  return { ...backend, user, view };
}

function grid() {
  return screen.getByRole("grid", { name: "Worksheet grid" });
}

function cellValue(coordinate: string) {
  return within(grid()).getByRole("gridcell", { name: coordinate }).textContent;
}

function openRowMenu(row: number) {
  const header = screen.getByRole("rowheader", { name: String(row) });
  fireEvent.contextMenu(header);
  return { header, menu: screen.getByRole("menu") };
}

function openColumnMenu(letter: string) {
  const header = screen.getByRole("columnheader", { name: letter });
  fireEvent.contextMenu(header);
  return { header, menu: screen.getByRole("menu") };
}

describe("row number menu", () => {
  it("opens on right click with the documented commands in order", async () => {
    await openSeededEditor();
    const { header, menu } = openRowMenu(2);

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 row above",
      "Insert 1 row below",
      "Delete row",
    ]);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("inserts a blank row above the target row and keeps it after refresh", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const { menu } = openRowMenu(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    await waitFor(() => expect(cellValue("A3")).toBe("East"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("B1")).toBe("Sales");
    expect(cellValue("A2")).toBe("");
    expect(cellValue("B3")).toBe("1200");
    expect(cellValue("A4")).toBe("North");
    expect(cellValue("B4")).toBe("800");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(cellValue("A2")).toBe("");
    expect(cellValue("A3")).toBe("East");
    expect(cellValue("A4")).toBe("North");
  });

  it("inserts a blank row below the target row", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const { menu } = openRowMenu(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row below" }));

    await waitFor(() => expect(cellValue("A4")).toBe("North"));
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("B2")).toBe("1200");
    expect(cellValue("A3")).toBe("");
    expect(cellValue("B4")).toBe("800");
  });

  it("deletes the target row and shifts the following rows upward", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const { menu } = openRowMenu(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete row" }));

    await waitFor(() => expect(cellValue("A2")).toBe("North"));
    expect(cellValue("B2")).toBe("800");
    expect(cellValue("A3")).toBe("South");
    expect(cellValue("A1")).toBe("Region");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(cellValue("A2")).toBe("North");
    expect(cellValue("A3")).toBe("South");
  });

  it("keeps the pre-operation structure when the request fails", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;
    backend.failNextRequest((_method, path) => path.endsWith("/rows"), { error: "Row could not be inserted" });

    const { menu } = openRowMenu(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));

    expect(await screen.findByText("Row could not be inserted")).toBeTruthy();
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("A3")).toBe("North");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("A3")).toBe("North");
  });
});

describe("column header menu", () => {
  it("opens on right click with the documented commands in order", async () => {
    await openSeededEditor();
    const { menu } = openColumnMenu("B");

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Insert 1 column left",
      "Insert 1 column right",
      "Delete column",
    ]);
  });

  it("inserts a blank column to the left of the target column", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const { menu } = openColumnMenu("B");
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column left" }));

    await waitFor(() => expect(cellValue("C1")).toBe("Sales"));
    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("B1")).toBe("");
    expect(cellValue("C2")).toBe("1200");
    expect(cellValue("C3")).toBe("800");
    expect(cellValue("A2")).toBe("East");
  });

  it("inserts a blank column to the right of the target column", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const { menu } = openColumnMenu("A");
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 column right" }));

    await waitFor(() => expect(cellValue("C1")).toBe("Sales"));
    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("B1")).toBe("");
    expect(cellValue("A2")).toBe("East");
  });

  it("deletes the target column and preserves the data outside it", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    const { menu } = openColumnMenu("B");
    await user.click(within(menu).getByRole("menuitem", { name: "Delete column" }));

    await waitFor(() => expect(cellValue("B1")).toBe("Status"));
    expect(cellValue("A1")).toBe("Region");
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("A3")).toBe("North");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("B2")).toBe("Open");
  });
});

describe("worksheet independence", () => {
  it("only changes the worksheet whose header menu was used", async () => {
    const backend = await openSeededEditor();
    const { user } = backend;

    await user.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() => expect(cellValue("A1")).toBe(""));

    const { menu } = openRowMenu(2);
    await user.click(within(menu).getByRole("menuitem", { name: "Insert 1 row above" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() => expect(cellValue("A2")).toBe("East"));
    expect(cellValue("A3")).toBe("North");
    expect(cellValue("A2")).not.toBe("");

    cleanup();
    backend.install();
    window.location.hash = "#/workbooks/wb-q3-sales";
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Q3 Sales" });
    expect(cellValue("A2")).toBe("East");
    expect(cellValue("A3")).toBe("North");
  });
});
