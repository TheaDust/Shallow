import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { seededSummary, seededWorkbook } from "./test/fixtures";

const api = vi.hoisted(() => ({
  listWorkbooks: vi.fn(),
  createWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  renameWorkbook: vi.fn(),
  setActiveSheet: vi.fn(),
  importWorkbook: vi.fn(),
  addWorksheet: vi.fn(),
  renameSheet: vi.fn(),
  changeSheetStructure: vi.fn(),
}));

vi.mock("./lib/api", () => api);

describe("App routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/";
    api.listWorkbooks.mockResolvedValue([seededSummary]);
    api.getWorkbook.mockResolvedValue(seededWorkbook);
  });

  it("opens a workbook from the home page link and renders the editor", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Q3 Sales" }));

    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/workbook/wb-seed-q3");
    expect(screen.getByRole("grid", { name: "Worksheet grid" })).toBeInTheDocument();
  });

  it("restores the workbook editor when the exact editor entry is visited directly", async () => {
    window.location.hash = "#/workbook/wb-seed-q3";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Q3 Sales" })).toBeInTheDocument();
    expect(api.getWorkbook).toHaveBeenCalledWith("wb-seed-q3");
  });
});
