import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookHomePage } from "../WorkbookHomePage";
import { SEED_UPDATED_TEXT, stubFetch, summaryFixture, workbookFixture } from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.location.hash = "";
});

describe("workbook home page", () => {
  it("lists every workbook with its last updated value and a link named after the workbook", async () => {
    stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks"
        ? { body: { workbooks: [summaryFixture()] } }
        : undefined,
    );
    render(<WorkbookHomePage />);

    const link = await screen.findByRole("link", { name: "Q3 Sales" });
    expect(link.getAttribute("href")).toBe("#/workbooks/wb-q3-sales");
    expect(screen.getByText(`Last updated: ${SEED_UPDATED_TEXT}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "New blank workbook" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeTruthy();
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("offers the Import CSV dialog with a CSV file control and a Confirm import button", async () => {
    const user = userEvent.setup();
    stubFetch((request) =>
      request.method === "GET" && request.path === "/api/workbooks"
        ? { body: { workbooks: [summaryFixture()] } }
        : undefined,
    );
    render(<WorkbookHomePage />);
    await screen.findByRole("link", { name: "Q3 Sales" });

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Import CSV" }));

    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const fileInput = within(dialog).getByLabelText("CSV file") as HTMLInputElement;
    expect(fileInput.type).toBe("file");
    expect(within(dialog).getByRole("button", { name: "Confirm import" })).toBeTruthy();
  });

  it("imports the selected CSV file and enters the created workbook", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks") {
        return { body: { workbooks: [summaryFixture()] } };
      }
      if (request.method === "POST" && request.path === "/api/workbooks/import") {
        return { status: 201, body: { workbook: workbookFixture({ id: "wb-pipeline", name: "Pipeline" }) } };
      }
      return undefined;
    });
    render(<WorkbookHomePage />);
    await screen.findByRole("link", { name: "Q3 Sales" });
    await user.click(screen.getByRole("button", { name: "Import CSV" }));

    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const file = new File(["Region\nEast,1200"], "Pipeline.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText("CSV file") as HTMLInputElement, file);
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    await waitFor(() => expect(window.location.hash).toBe("#/workbooks/wb-pipeline"));
    const importCall = calls.find((call) => call.path === "/api/workbooks/import");
    expect(importCall?.body).toEqual({ fileName: "Pipeline.csv", content: "Region\nEast,1200" });
  });

  it("shows the parse error beside the CSV file control and keeps no partial record", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks") {
        return { body: { workbooks: [summaryFixture()] } };
      }
      if (request.method === "POST" && request.path === "/api/workbooks/import") {
        return { status: 400, body: { error: "Invalid CSV file format. Import failed." } };
      }
      return undefined;
    });
    render(<WorkbookHomePage />);
    await screen.findByRole("link", { name: "Q3 Sales" });
    await user.click(screen.getByRole("button", { name: "Import CSV" }));

    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const file = new File(['Region\n"East,1200'], "broken.csv", { type: "text/csv" });
    const input = within(dialog).getByLabelText("CSV file") as HTMLInputElement;
    await user.upload(input, file);
    await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Invalid CSV file format. Import failed.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Import CSV" })).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(calls.filter((call) => call.path === "/api/workbooks/import")).toHaveLength(1);
  });

  it("reports a failed list load with a retry action", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    stubFetch((request) => {
      if (request.method === "GET" && request.path === "/api/workbooks") {
        attempts += 1;
        return attempts === 1
          ? { status: 500, body: { error: "Workbook store unavailable" } }
          : { body: { workbooks: [summaryFixture()] } };
      }
      return undefined;
    });
    render(<WorkbookHomePage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Workbook store unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Q3 Sales" })).toBeTruthy();
  });
});
