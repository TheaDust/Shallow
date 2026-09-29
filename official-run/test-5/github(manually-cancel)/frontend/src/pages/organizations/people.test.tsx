import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedInSession } from "../../test/harness";
import type { OrganizationMember } from "../../org/types";

const ORG_NAME = "Acme Demo";
const ORG_PATH = "/api/organizations/Acme%20Demo";

const ORGANIZATION_DETAIL = {
  id: "org-acme-demo",
  name: ORG_NAME,
  displayName: ORG_NAME,
  createdAt: "2024-01-05T09:00:00.000Z",
  role: "owner",
  isMember: true,
};

const SEED_MEMBERS: OrganizationMember[] = [
  { username: "alice-dev", role: "owner" },
  { username: "bob-reviewer", role: "member" },
];

function session(username: string) {
  return signedInSession(username, `${username}@example.test`);
}

function organizationDetail(role: "owner" | "member" | null) {
  return { ...ORGANIZATION_DETAIL, role, isMember: Boolean(role) };
}

/** The “People” panel of the organization page. */
async function peoplePanel() {
  return screen.findByRole("region", { name: "People" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("directly add an organization member (REQ-2-2-3)", () => {
  it("opens the add form from “Add member”, keeps the submission button unique and lists the new Member", async () => {
    let members = [...SEED_MEMBERS];
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: organizationDetail("owner") } }),
      [`GET ${ORG_PATH}/people`]: () => ({ status: 200, body: { members, viewerRole: "owner" } }),
      [`POST ${ORG_PATH}/people`]: ({ body }) => {
        const values = body as { identifier: string; role: string };
        if (values.identifier === "carol-writer") {
          members = [...members, { username: "carol-writer", role: "member" }];
          return { status: 200, body: { members } };
        }
        return {
          status: 400,
          body: { error: "Member not added", errors: { identifier: "Account not found" } },
        };
      },
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    const panel = await peoplePanel();
    expect(within(panel).getByText("bob-reviewer")).not.toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Add member" }));

    const identifierField = screen.getByLabelText("Username or email") as HTMLInputElement;
    const roleSelect = screen.getByLabelText("Role") as HTMLSelectElement;
    expect([...roleSelect.options].map((option) => option.textContent)).toEqual(["Member", "Owner"]);
    expect(roleSelect.value).toBe("member");
    // The opening button is gone while the form is open: a single “Add member”.
    expect(screen.getAllByRole("button", { name: "Add member" })).toHaveLength(1);

    await user.type(identifierField, "carol-writer");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const row = (await within(panel).findByText("carol-writer")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Member")).not.toBeNull();
    expect(within(panel).queryByText(/Pending|Awaiting/)).toBeNull();
    expect(within(panel).getAllByText("carol-writer")).toHaveLength(1);
    expect(within(panel).getAllByText("bob-reviewer")).toHaveLength(1);

    // Refreshing the view reads the same persisted relationship.
    window.location.hash = `#/organizations/${encodeURIComponent(ORG_NAME)}/people`;
    const reloaded = await peoplePanel();
    expect(within(reloaded).getByText("carol-writer")).not.toBeNull();
    expect(within(reloaded).queryByText(/Pending|Awaiting/)).toBeNull();
  });

  it("keeps the form open and reports an existing member and an unknown account", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: organizationDetail("owner") } }),
      [`GET ${ORG_PATH}/people`]: () => ({
        status: 200,
        body: { members: SEED_MEMBERS, viewerRole: "owner" },
      }),
      [`POST ${ORG_PATH}/people`]: ({ body }) => {
        const identifier = (body as { identifier: string }).identifier;
        return {
          status: 400,
          body: {
            error: "Member not added",
            errors: {
              identifier:
                identifier === "bob-reviewer" ? "Account is already a member" : "Account not found",
            },
          },
        };
      },
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const identifierField = screen.getByLabelText("Username or email") as HTMLInputElement;

    await user.type(identifierField, "bob-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account is already a member")).not.toBeNull();
    expect(identifierField.value).toBe("bob-reviewer");
    const panel = await peoplePanel();
    expect(within(panel).getAllByText("bob-reviewer")).toHaveLength(1);

    await user.clear(identifierField);
    await user.type(identifierField, "unknown-reviewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Account not found")).not.toBeNull();
    expect(identifierField.value).toBe("unknown-reviewer");
  });

  it("offers an Owner role option that stores the Owner membership", async () => {
    let members = [...SEED_MEMBERS];
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: organizationDetail("owner") } }),
      [`GET ${ORG_PATH}/people`]: () => ({ status: 200, body: { members, viewerRole: "owner" } }),
      [`POST ${ORG_PATH}/people`]: ({ body }) => {
        const values = body as { identifier: string; role: string };
        members = [...members, { username: values.identifier, role: values.role as "owner" }];
        return { status: 200, body: { members } };
      },
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Username or email"), "dana-owner");
    await user.selectOptions(screen.getByLabelText("Role"), "owner");
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("owner");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const panel = await peoplePanel();
    const row = (await within(panel).findByText("dana-owner")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Owner")).not.toBeNull();
  });

  it("shows no member controls to a plain organization member", async () => {
    installFetch({
      "GET /api/auth/session": () => session("bob-reviewer"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: organizationDetail("member") } }),
      [`GET ${ORG_PATH}/people`]: () => ({
        status: 200,
        body: { members: SEED_MEMBERS, viewerRole: "member" },
      }),
    });
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    const panel = await peoplePanel();
    expect(within(panel).getByText("bob-reviewer")).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: "Add member" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Member menu bob-reviewer" })).toBeNull();
    expect(within(panel).queryByRole("menuitem", { name: "Remove from organization" })).toBeNull();
  });
});

describe("remove an organization member (REQ-2-2-4)", () => {
  it("removes the member through the named menu and the confirmation dialog", async () => {
    let members = [...SEED_MEMBERS];
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: organizationDetail("owner") } }),
      [`GET ${ORG_PATH}/people`]: () => ({ status: 200, body: { members, viewerRole: "owner" } }),
      [`DELETE ${ORG_PATH}/people/bob-reviewer`]: () => {
        members = members.filter((member) => member.username !== "bob-reviewer");
        return { status: 200, body: { members } };
      },
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    const panel = await peoplePanel();
    await user.click(within(panel).getByRole("button", { name: "Member menu bob-reviewer" }));
    const item = await screen.findByRole("menuitem", { name: "Remove from organization" });
    await user.click(item);

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(panel).queryByText("bob-reviewer")).toBeNull());
    expect(within(panel).getByText("alice-dev")).not.toBeNull();

    // Reloading the People page keeps the removed username absent.
    window.location.hash = `#/organizations/${encodeURIComponent(ORG_NAME)}/people`;
    const reloaded = await peoplePanel();
    await waitFor(() => expect(within(reloaded).queryByText("bob-reviewer")).toBeNull());
    expect(within(reloaded).getByText("alice-dev")).not.toBeNull();
  });

  it("keeps the member when the server rejects removing the last Owner", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ORG_PATH}`]: () => ({ status: 200, body: { organization: organizationDetail("owner") } }),
      [`GET ${ORG_PATH}/people`]: () => ({
        status: 200,
        body: { members: SEED_MEMBERS, viewerRole: "owner" },
      }),
      [`DELETE ${ORG_PATH}/people/alice-dev`]: () => ({
        status: 400,
        body: { error: "The organization must keep at least one Owner" },
      }),
    });
    const user = userEvent.setup();
    renderApp(`#/organizations/${encodeURIComponent(ORG_NAME)}/people`);

    const panel = await peoplePanel();
    await user.click(within(panel).getByRole("button", { name: "Member menu alice-dev" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from organization" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("The organization must keep at least one Owner")).not.toBeNull();
    expect(within(panel).getByText("alice-dev")).not.toBeNull();
    expect(within(panel).getByText("bob-reviewer")).not.toBeNull();
  });
});
