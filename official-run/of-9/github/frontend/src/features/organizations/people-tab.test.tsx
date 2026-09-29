import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PeopleTab } from "./PeopleTab";

const mocks = vi.hoisted(() => ({
  listPeople: vi.fn(),
  addOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
}));

vi.mock("./api", () => ({
  listPeople: mocks.listPeople,
  addOrganizationMember: mocks.addOrganizationMember,
  removeOrganizationMember: mocks.removeOrganizationMember,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPeople.mockResolvedValue([
    { username: "alice-dev", role: "owner" },
    { username: "bob-reviewer", role: "member" },
  ]);
  mocks.addOrganizationMember.mockResolvedValue({ ok: true, member: { username: "carol-dev", role: "member" } });
  mocks.removeOrganizationMember.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe("PeopleTab for an Owner", () => {
  it("renders the member rows with role labels and a Member menu per member", async () => {
    render(<PeopleTab orgId="acme-demo" isOwner />);
    const list = await screen.findByRole("list");
    expect(within(list).getByText("alice-dev")).toBeTruthy();
    expect(within(list).getByText("Owner")).toBeTruthy();
    expect(within(list).getByText("bob-reviewer")).toBeTruthy();
    expect(within(list).getByText("Member")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Member menu alice-dev" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Member menu bob-reviewer" })).toBeTruthy();
  });

  it("opens the add form with the Username or email field, Role combobox and a submit button after the opening button", async () => {
    const user = userEvent.setup();
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await screen.findByRole("list");

    const opening = screen.getByRole("button", { name: "Add member" });
    await user.click(opening);

    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    const role = screen.getByLabelText("Role") as HTMLSelectElement;
    expect(role.tagName).toBe("SELECT");
    expect(role.value).toBe("Member");
    const options = within(role).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Member", "Owner"]);

    // The opening button remains present and the submission button follows it.
    const buttons = screen.getAllByRole("button", { name: "Add member" });
    expect(buttons).toHaveLength(2);
    const openingIndex = buttons.indexOf(opening);
    expect(buttons[openingIndex + 1].getAttribute("type")).toBe("submit");
  });

  it("adds a member by username, closes the form and shows the row with the Member role", async () => {
    const user = userEvent.setup();
    mocks.listPeople
      .mockResolvedValueOnce([
        { username: "alice-dev", role: "owner" },
        { username: "bob-reviewer", role: "member" },
      ])
      .mockResolvedValueOnce([
        { username: "alice-dev", role: "owner" },
        { username: "bob-reviewer", role: "member" },
        { username: "carol-dev", role: "member" },
      ]);
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));

    await user.type(screen.getByLabelText("Username or email"), "carol-dev");
    await user.click(screen.getAllByRole("button", { name: "Add member" })[1]);

    const list = await screen.findByRole("list");
    expect(within(list).getByText("carol-dev")).toBeTruthy();
    const row = within(list).getByText("carol-dev").closest("li");
    expect(within(row as HTMLElement).getByText("Member")).toBeTruthy();
    expect(within(list).queryByText("Pending")).toBeNull();
    expect(within(list).queryByText("Awaiting")).toBeNull();
    expect(mocks.addOrganizationMember).toHaveBeenCalledWith("acme-demo", {
      username: "carol-dev",
      role: "member",
    });
    // The add form is closed after a successful add.
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });

  it("adds a member by verified email with the Owner role", async () => {
    const user = userEvent.setup();
    mocks.listPeople
      .mockResolvedValueOnce([
        { username: "alice-dev", role: "owner" },
        { username: "bob-reviewer", role: "member" },
      ])
      .mockResolvedValueOnce([
        { username: "alice-dev", role: "owner" },
        { username: "bob-reviewer", role: "owner" },
      ]);
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username or email"), "bob.reviewer@example.test");
    await user.selectOptions(screen.getByLabelText("Role"), "Owner");
    await user.click(screen.getAllByRole("button", { name: "Add member" })[1]);

    await waitFor(() =>
      expect(mocks.addOrganizationMember).toHaveBeenCalledWith("acme-demo", {
        username: "bob.reviewer@example.test",
        role: "owner",
      }),
    );
  });

  it("keeps the form open with the reason when the account is already a member", async () => {
    const user = userEvent.setup();
    mocks.addOrganizationMember.mockResolvedValue({
      ok: false,
      errors: { username: "Account is already a member" },
    });
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username or email"), "bob-reviewer");
    await user.click(screen.getAllByRole("button", { name: "Add member" })[1]);

    expect(await screen.findByText("Account is already a member")).toBeTruthy();
    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    // The existing member's complete username appears only once.
    expect(screen.getAllByText("bob-reviewer")).toHaveLength(1);
  });

  it("keeps the form open with Account not found for an unknown username", async () => {
    const user = userEvent.setup();
    mocks.addOrganizationMember.mockResolvedValue({
      ok: false,
      errors: { username: "Account not found" },
    });
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username or email"), "unknown-reviewer");
    await user.click(screen.getAllByRole("button", { name: "Add member" })[1]);

    expect(await screen.findByText("Account not found")).toBeTruthy();
    expect(screen.getByLabelText("Username or email")).toBeTruthy();
  });

  it("removes a member through the action menu and confirmation dialog", async () => {
    const user = userEvent.setup();
    mocks.listPeople
      .mockResolvedValueOnce([
        { username: "alice-dev", role: "owner" },
        { username: "bob-reviewer", role: "member" },
      ])
      .mockResolvedValueOnce([{ username: "alice-dev", role: "owner" }]);
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await screen.findByRole("list");

    await user.click(screen.getByRole("button", { name: "Member menu bob-reviewer" }));
    const menu = screen.getByRole("menu", { name: "Member actions for bob-reviewer" });
    await user.click(within(menu).getByRole("menuitem", { name: "Remove from organization" }));

    const dialog = await screen.findByRole("dialog", { name: "Remove member" });
    expect(dialog).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByText("bob-reviewer")).toBeNull());
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith("acme-demo", "bob-reviewer");
  });

  it("keeps the member and shows the reason when removal is rejected", async () => {
    const user = userEvent.setup();
    mocks.removeOrganizationMember.mockResolvedValue({
      ok: false,
      errors: { username: "The organization must have at least one Owner" },
    });
    render(<PeopleTab orgId="acme-demo" isOwner />);
    await screen.findByRole("list");

    await user.click(screen.getByRole("button", { name: "Member menu alice-dev" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from organization" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove member" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("The organization must have at least one Owner")).toBeTruthy();
    expect(screen.getByText("alice-dev")).toBeTruthy();
  });
});

describe("PeopleTab for a non-Owner", () => {
  it("shows members without an Add member button or member menu buttons", async () => {
    render(<PeopleTab orgId="acme-demo" isOwner={false} />);
    const list = await screen.findByRole("list");
    expect(within(list).getByText("bob-reviewer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Member menu bob-reviewer" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  });
});
