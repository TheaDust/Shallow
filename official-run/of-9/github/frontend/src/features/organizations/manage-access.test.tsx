import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManageAccessPage } from "./ManageAccessPage";

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  setGrant: vi.fn(),
}));

vi.mock("./api", () => ({
  getAccess: mocks.getAccess,
  setGrant: mocks.setGrant,
  REPO_ROLES: ["read", "triage", "write", "maintain", "admin"],
  REPO_ROLE_LABELS: {
    read: "Read",
    triage: "Triage",
    write: "Write",
    maintain: "Maintain",
    admin: "Admin",
  },
}));

const now = new Date().toISOString();

const baseAccess = {
  grants: [
    {
      subjectType: "team",
      subjectId: "acme-demo:frontend-team",
      subjectName: "frontend-team",
      role: "write",
      grantedBy: "alice-dev",
      createdAt: now,
    },
  ],
  members: [{ username: "bob-reviewer" }],
  teams: [
    { id: "acme-demo:frontend-team", name: "frontend-team" },
    { id: "acme-demo:backend-team", name: "backend-team" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccess.mockResolvedValue(baseAccess);
  mocks.setGrant.mockResolvedValue({ ok: true, grant: { subjectType: "team", subjectId: "acme-demo:frontend-team", subjectName: "frontend-team", role: "write", grantedBy: "alice-dev", createdAt: now } });
});

afterEach(() => {
  cleanup();
});

describe("ManageAccessPage", () => {
  it("renders existing grants as rows with a Role select and Save button", async () => {
    render(<ManageAccessPage owner="acme-demo" name="acme-private" />);
    const row = await screen.findByRole("row", { name: "frontend-team" });
    expect(row).toBeTruthy();
    const select = within(row).getByRole("combobox", { name: "Role" }) as HTMLSelectElement;
    expect(select.value).toBe("write");
    expect(within(row).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add people or teams" })).toBeTruthy();
  });

  it("opens the picker with Search, matching options, Role combobox and Add; hides the opening button", async () => {
    const user = userEvent.setup();
    render(<ManageAccessPage owner="acme-demo" name="acme-private" />);
    await screen.findByText("frontend-team");

    await user.click(screen.getByRole("button", { name: "Add people or teams" }));
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();

    const search = screen.getByLabelText("Search");
    expect(search).toBeTruthy();
    expect(screen.getByRole("option", { name: "frontend-team" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "bob-reviewer" })).toBeTruthy();

    // Options update as the administrator types, without Enter.
    await user.type(search, "front");
    expect(screen.getByRole("option", { name: "frontend-team" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "bob-reviewer" })).toBeNull();

    const roleCombobox = within(screen.getByRole("form", { name: "Add people or teams" })).getByRole("combobox", { name: "Role" });
    expect(roleCombobox.tagName).toBe("BUTTON");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();

    // Opening the Role combobox exposes visible, clickable role options.
    await user.click(roleCombobox);
    expect(roleCombobox.getAttribute("aria-expanded")).toBe("true");
    const roleListbox = screen.getByRole("listbox", { name: "Role" });
    expect(within(roleListbox).getByRole("option", { name: "Read" })).toBeTruthy();
    expect(within(roleListbox).getByRole("option", { name: "Triage" })).toBeTruthy();
    expect(within(roleListbox).getByRole("option", { name: "Write" })).toBeTruthy();
    expect(within(roleListbox).getByRole("option", { name: "Maintain" })).toBeTruthy();
    expect(within(roleListbox).getByRole("option", { name: "Admin" })).toBeTruthy();
  });

  it("adds a team with the Write role and shows exactly one row", async () => {
    const user = userEvent.setup();
    mocks.setGrant.mockResolvedValue({
      ok: true,
      grant: { subjectType: "team", subjectId: "acme-demo:backend-team", subjectName: "backend-team", role: "write", grantedBy: "alice-dev", createdAt: now },
    });
    mocks.getAccess.mockResolvedValueOnce(baseAccess).mockResolvedValueOnce({
      ...baseAccess,
      grants: [
        ...baseAccess.grants,
        { subjectType: "team", subjectId: "acme-demo:backend-team", subjectName: "backend-team", role: "write", grantedBy: "alice-dev", createdAt: now },
      ],
    });
    render(<ManageAccessPage owner="acme-demo" name="acme-private" />);
    await screen.findByText("frontend-team");

    await user.click(screen.getByRole("button", { name: "Add people or teams" }));
    const picker = screen.getByRole("form", { name: "Add people or teams" });
    await user.type(within(picker).getByLabelText("Search"), "backend");
    await user.click(within(picker).getByRole("option", { name: "backend-team" }));
    await user.click(within(picker).getByRole("combobox", { name: "Role" }));
    await user.click(within(picker).getByRole("option", { name: "Write" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("backend-team")).toBeTruthy();
    expect(mocks.setGrant).toHaveBeenCalledWith("acme-demo", "acme-private", {
      subjectType: "team",
      subjectId: "acme-demo:backend-team",
      role: "write",
    });
    expect(screen.getAllByText("frontend-team")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add people or teams" })).toBeTruthy();
  });

  it("replaces Write with Read when the row role is changed and saved", async () => {
    const user = userEvent.setup();
    mocks.setGrant.mockResolvedValue({
      ok: true,
      grant: { subjectType: "team", subjectId: "acme-demo:frontend-team", subjectName: "frontend-team", role: "read", grantedBy: "alice-dev", createdAt: now },
    });
    mocks.getAccess.mockResolvedValueOnce(baseAccess).mockResolvedValueOnce({
      ...baseAccess,
      grants: [{ subjectType: "team", subjectId: "acme-demo:frontend-team", subjectName: "frontend-team", role: "read", grantedBy: "alice-dev", createdAt: now }],
    });
    render(<ManageAccessPage owner="acme-demo" name="acme-private" />);
    await screen.findByRole("row", { name: "frontend-team" });

    const rowSelect = screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement;
    await user.selectOptions(rowSelect, "read");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("read"));
    expect(mocks.setGrant).toHaveBeenCalledWith("acme-demo", "acme-private", {
      subjectType: "team",
      subjectId: "acme-demo:frontend-team",
      role: "read",
    });
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
