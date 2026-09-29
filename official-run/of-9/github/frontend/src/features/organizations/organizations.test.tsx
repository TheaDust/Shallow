import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationsPage } from "./OrganizationsPage";
import { NewOrganizationPage } from "./NewOrganizationPage";

const mocks = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
}));

vi.mock("./api", () => ({
  listOrganizations: mocks.listOrganizations,
  createOrganization: mocks.createOrganization,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
});

describe("OrganizationsPage", () => {
  it("renders the New organization link and the accessible organization list", async () => {
    mocks.listOrganizations.mockResolvedValue([
      { id: "acme-demo", displayName: "Acme Demo", createdAt: "2026-01-01T00:00:00.000Z", role: "owner" },
    ]);
    render(<OrganizationsPage />);
    expect(await screen.findByRole("link", { name: "New organization" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Acme Demo" })).toBeTruthy();
    expect(screen.getByText("acme-demo")).toBeTruthy();
  });

  it("shows an empty state for an account without organizations", async () => {
    mocks.listOrganizations.mockResolvedValue([]);
    render(<OrganizationsPage />);
    expect(await screen.findByText("You are not a member of any organization.")).toBeTruthy();
  });
});

describe("NewOrganizationPage", () => {
  it("renders the labeled fields and Create organization button", () => {
    render(<NewOrganizationPage />);
    expect(screen.getByLabelText("Organization name")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create organization" })).toBeTruthy();
  });

  it("navigates to the new organization overview on success", async () => {
    const user = userEvent.setup();
    mocks.createOrganization.mockResolvedValue({
      ok: true,
      organization: { id: "mobile-guild", displayName: "Mobile Guild", createdAt: "2026-01-01T00:00:00.000Z", role: "owner" },
    });
    render(<NewOrganizationPage />);
    await user.type(screen.getByLabelText("Organization name"), "mobile-guild");
    await user.type(screen.getByLabelText("Display name"), "Mobile Guild");
    await user.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(window.location.hash).toBe("#/orgs/mobile-guild"));
    expect(mocks.createOrganization).toHaveBeenCalledWith({ name: "mobile-guild", displayName: "Mobile Guild" });
  });

  it("shows field errors and retains non-sensitive input on rejection", async () => {
    const user = userEvent.setup();
    mocks.createOrganization.mockResolvedValue({
      ok: false,
      errors: { name: "Organization name already exists", displayName: "Display name is required" },
    });
    render(<NewOrganizationPage />);
    await user.type(screen.getByLabelText("Organization name"), "acme-demo");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    expect(await screen.findByText("Organization name already exists")).toBeTruthy();
    expect(screen.getByText("Display name is required")).toBeTruthy();
    expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("acme-demo");
    expect(window.location.hash).toBe("");
  });

  it("keeps the form on the page for malformed names", async () => {
    const user = userEvent.setup();
    mocks.createOrganization.mockResolvedValue({
      ok: false,
      errors: { name: "Organization name format is invalid" },
    });
    render(<NewOrganizationPage />);
    await user.type(screen.getByLabelText("Organization name"), "-invalid-organization");
    await user.type(screen.getByLabelText("Display name"), "Something");
    await user.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Organization name format is invalid")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create organization" })).toBeTruthy();
  });
});
