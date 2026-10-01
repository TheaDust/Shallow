import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { WorkbookState } from "../domain/workbook";

const SEED_UPDATED_AT = "2026-03-14T09:32:00.000Z";

function seedWorkbook(): WorkbookState {
  return {
    id: "wb-q3-sales",
    name: "Q3 Sales",
    createdAt: SEED_UPDATED_AT,
    updatedAt: SEED_UPDATED_AT,
    activeSheetId: "wb-q3-sales-sheet-1",
    sheets: [{ id: "wb-q3-sales-sheet-1", name: "Sheet1", cells: { A1: "Region" } }],
  };
}

interface FakeApiOptions {
  createStatus?: number;
  renameStatus?: number;
}

function installFakeApi(options: FakeApiOptions = {}) {
  const workbooks = [seedWorkbook()];
  const calls: { method: string; path: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    const json = (status: number, payload: unknown) => ({
      ok: status < 400,
      status,
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });

    if (path === "/api/workbooks" && method === "GET") {
      return json(200, {
        workbooks: workbooks.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
      });
    }
    if (path === "/api/workbooks" && method === "POST") {
      if (options.createStatus && options.createStatus >= 400) {
        return json(options.createStatus, { error: "Unable to create workbook" });
      }
      const id = `wb-${workbooks.length + 1}`;
      const sheetId = `${id}-sheet-1`;
      const workbook: WorkbookState = {
        id,
        name: (body as { name?: string }).name || "Untitled spreadsheet",
        createdAt: SEED_UPDATED_AT,
        updatedAt: SEED_UPDATED_AT,
        activeSheetId: sheetId,
        sheets: [{ id: sheetId, name: "Sheet1", cells: {} }],
      };
      workbooks.push(workbook);
      return json(201, { workbook });
    }

    const match = /^\/api\/workbooks\/([^/]+)$/.exec(path);
    if (match) {
      const workbook = workbooks.find((entry) => entry.id === decodeURIComponent(match[1]));
      if (!workbook) return json(404, { error: "Workbook not found" });
      if (method === "PATCH") {
        if (options.renameStatus && options.renameStatus >= 400) {
          return json(options.renameStatus, { error: "Unable to rename workbook" });
        }
        const patch = body as { name?: string; activeSheetId?: string };
        if (typeof patch.name === "string") {
          const name = patch.name.trim();
          if (!name) return json(400, { error: "Workbook name cannot be empty" });
          workbook.name = name;
          workbook.updatedAt = "2026-04-01T10:00:00.000Z";
        }
        if (patch.activeSheetId) workbook.activeSheetId = patch.activeSheetId;
        return json(200, { workbook });
      }
      return json(200, { workbook });
    }
    return json(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { workbooks, calls };
}

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "#/";
});

describe("workbook home page", () => {
  it("lists each workbook with its name as a link and the last updated value", async () => {
    installFakeApi();
    renderAt("#/");

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link.getAttribute("href")).toBe("#/workbooks/wb-q3-sales");
    expect(screen.getByText("Last updated: 2026-03-14 09:32")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeTruthy();
  });

  it("keeps the renamed workbook name after returning to the home page", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");

    await user.click(await screen.findByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const input = within(dialog).getByLabelText("Workbook name");
    await user.clear(input);
    await user.type(input, "Q3 Sales 2026");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByRole("heading", { name: "Q3 Sales 2026", level: 1 });

    window.location.hash = "#/";
    expect(await screen.findByRole("link", { name: "Q3 Sales 2026" })).toBeTruthy();
  });
});

describe("workbook editor page", () => {
  it("shows the workbook identity, tabs, formula bar and an accessible grid", async () => {
    installFakeApi();
    renderAt("#/workbooks/wb-q3-sales");

    await screen.findByRole("heading", { name: "Q3 Sales", level: 1 });
    expect(screen.getByText("Last updated: 2026-03-14 09:32")).toBeTruthy();

    const sheetTab = screen.getByRole("tab", { name: "Sheet1" });
    expect(sheetTab.getAttribute("aria-selected")).toBe("true");

    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");

    const a1 = within(grid).getByRole("gridcell", { name: "A1" });
    expect(a1.textContent).toBe("Region");
    expect(a1.getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "B1" }).getAttribute("aria-selected")).toBe("false");
    expect((screen.getByLabelText("Formula bar") as HTMLInputElement).value).toBe("Region");
  });

  it("updates the selected region when another cell is clicked", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");

    const grid = await screen.findByRole("grid", { name: "Worksheet grid" });
    await user.click(within(grid).getByRole("gridcell", { name: "B2" }));

    expect(within(grid).getByRole("gridcell", { name: "B2" }).getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("false");
  });

  it("rejects an empty workbook name and keeps the saved name", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");

    await user.click(await screen.findByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const input = within(dialog).getByLabelText("Workbook name") as HTMLInputElement;
    expect(input.value).toBe("Q3 Sales");

    await user.clear(input);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Workbook name cannot be empty")).toBeTruthy();
    expect(dialog).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Q3 Sales", level: 1 })).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("trims the new workbook name before saving", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    renderAt("#/workbooks/wb-q3-sales");

    await user.click(await screen.findByRole("button", { name: "Rename workbook" }));
    const dialog = screen.getByRole("dialog", { name: "Rename workbook" });
    const input = within(dialog).getByLabelText("Workbook name");
    await user.clear(input);
    await user.type(input, "  Q3 Sales 2026  ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = api.calls.find((call) => call.method === "PATCH");
    expect(patch?.body).toEqual({ name: "Q3 Sales 2026" });
    await screen.findByRole("heading", { name: "Q3 Sales 2026", level: 1 });
    expect(screen.getByText("Last updated: 2026-04-01 10:00")).toBeTruthy();
  });
});

describe("blank workbook creation", () => {
  it("creates a blank workbook with an active Sheet1 and selects A1", async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderAt("#/");

    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));
    expect(window.location.hash).toBe("#/workbooks/new");

    const nameInput = screen.getByLabelText("Workbook name");
    await user.type(nameInput, "Fresh sheet");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(window.location.hash).toBe("#/workbooks/wb-2"));
    await screen.findByRole("heading", { name: "Fresh sheet", level: 1 });
    expect(screen.getByRole("tab", { name: "Sheet1" }).getAttribute("aria-selected")).toBe("true");
    const grid = screen.getByRole("grid", { name: "Worksheet grid" });
    expect(within(grid).getByRole("gridcell", { name: "A1" }).getAttribute("aria-selected")).toBe("true");
    expect(within(grid).getByRole("gridcell", { name: "A1" }).textContent).toBe("");
  });

  it("stays on the creation page with an error when creation fails", async () => {
    installFakeApi({ createStatus: 500 });
    const user = userEvent.setup();
    renderAt("#/");
    await user.click(await screen.findByRole("button", { name: "New blank workbook" }));

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(window.location.hash).toBe("#/workbooks/new");
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
