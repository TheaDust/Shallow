import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportCsvDialog } from "./ImportCsvDialog";
import { ApiError } from "../lib/api";
import { blankWorkbook } from "../test/fixtures";

const api = vi.hoisted(() => ({
  listWorkbooks: vi.fn(),
  createWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  renameWorkbook: vi.fn(),
  setActiveSheet: vi.fn(),
  importWorkbook: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, ...api };
});

function renderDialog() {
  const onOpenChange = vi.fn();
  render(<ImportCsvDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

describe("ImportCsvDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/";
    api.importWorkbook.mockResolvedValue(blankWorkbook);
  });

  it("reads the selected CSV file, imports it and navigates to the editor", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    const file = new File(["Region,Amount\nEast,1200"], "sales.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV file"), file);
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => expect(api.importWorkbook).toHaveBeenCalledTimes(1));
    expect(api.importWorkbook).toHaveBeenCalledWith("sales.csv", "Region,Amount\nEast,1200");
    await waitFor(() => expect(window.location.hash).toBe("#/workbook/wb-blank"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the invalid CSV error beside the file control and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    api.importWorkbook.mockRejectedValue(new ApiError("Invalid CSV file format. Import failed.", 400, {}));

    const file = new File(['a,"unclosed'], "broken.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("CSV file"), file);
    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid CSV file format. Import failed.");
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/");
  });

  it("requires a file to be selected before confirming", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("CSV file is required.");
    expect(api.importWorkbook).not.toHaveBeenCalled();
  });
});
