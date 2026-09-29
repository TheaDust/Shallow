import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installFetch, renderApp, signedInSession } from "../../test/harness";
import type { AccessSubject, RepositoryGrant, RepositoryRole } from "../../org/types";

const ORG_NAME = "Acme Demo";
const REPO_NAME = "acme-docs";
const ACCESS_PATH = `/api/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/access`;
const REPOSITORY_PATH = `/api/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}`;

const MEMBERS: AccessSubject[] = [
  { id: "acc-alice-dev", name: "alice-dev" },
  { id: "acc-bob-reviewer", name: "bob-reviewer" },
];

const TEAMS: AccessSubject[] = [
  { id: "team-frontend-child", name: "frontend-child" },
  { id: "team-frontend-team", name: "frontend-team" },
  { id: "team-platform-team", name: "platform-team" },
];

function session(username: string) {
  return signedInSession(username, `${username}@example.test`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("repository settings navigation (REQ-2-3)", () => {
  it("opens “Manage access” from the repository “Settings” link", async () => {
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${REPOSITORY_PATH}`]: () => ({
        status: 200,
        body: {
          repository: {
            name: REPO_NAME,
            description: "Public documentation",
            visibility: "public",
            updatedAt: null,
            createdAt: null,
            defaultBranch: "main",
            ownerName: ORG_NAME,
            fullName: `${ORG_NAME}/${REPO_NAME}`,
          },
        },
      }),
      [`GET ${ACCESS_PATH}`]: () => ({
        status: 200,
        body: { grants: [], members: MEMBERS, teams: TEAMS, viewerRole: "admin" },
      }),
    });
    const user = userEvent.setup();
    renderApp(`#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}`);

    const settings = await screen.findByRole("link", { name: "Settings" });
    expect(settings.getAttribute("href")).toBe(
      `#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/settings`,
    );
    await user.click(settings);

    const manageAccess = await screen.findByRole("link", { name: "Manage access" });
    expect(manageAccess.getAttribute("href")).toBe(
      `#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/settings/access`,
    );
    await user.click(manageAccess);

    expect(await screen.findByRole("heading", { name: "Manage access" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add people or teams" })).not.toBeNull();
  });
});

describe("grant repository access to a team (REQ-2-3)", () => {
  function installAccess(initial: RepositoryGrant[], viewerRole: RepositoryRole | null = "admin") {
    let grants = [...initial];
    const payload = () => ({ grants, members: MEMBERS, teams: TEAMS, viewerRole });
    installFetch({
      "GET /api/auth/session": () => session("alice-dev"),
      [`GET ${ACCESS_PATH}`]: () => ({ status: 200, body: payload() }),
      [`POST ${ACCESS_PATH}`]: ({ body }) => {
        const values = body as { subjectType: "account" | "team"; subjectId: string; role: RepositoryRole };
        const name = [...TEAMS, ...MEMBERS].find((subject) => subject.id === values.subjectId)?.name ?? "";
        const existing = grants.find(
          (grant) =>
            grant.subjectType === values.subjectType && grant.subjectId === values.subjectId,
        );
        if (existing) {
          existing.role = values.role;
        } else {
          grants = [
            ...grants,
            {
              id: `grant-${grants.length + 1}`,
              subjectType: values.subjectType,
              subjectId: values.subjectId,
              subjectName: name,
              role: values.role,
              createdAt: null,
            },
          ];
        }
        return { status: 200, body: payload() };
      },
    });
    return {
      get grants() {
        return grants;
      },
    };
  }

  async function grantTable() {
    return screen.findByRole("table");
  }

  /** The Role combobox of the picker (the grant rows have their own “Role” selects). */
  function pickerRole() {
    return document.getElementById("access-role") as HTMLSelectElement;
  }

  it("lists the matching team option, stores one Write grant and keeps it after reload", async () => {
    installAccess([]);
    const user = userEvent.setup();
    renderApp(`#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/settings/access`);

    await screen.findByRole("heading", { name: "Manage access" });
    await user.click(screen.getByRole("button", { name: "Add people or teams" }));

    // The opening button is hidden while the picker is active.
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
    const search = screen.getByLabelText("Search");
    expect(screen.getByRole("option", { name: "frontend-team" })).not.toBeNull();

    await user.type(search, "front");
    expect(screen.queryByRole("option", { name: "bob-reviewer" })).toBeNull();
    expect(screen.getByRole("option", { name: "frontend-team" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "frontend-child" })).not.toBeNull();

    await user.click(screen.getByRole("option", { name: "frontend-team" }));
    expect(screen.getByRole("option", { name: "frontend-team" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await user.selectOptions(pickerRole(), "write");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const table = await grantTable();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2); // header + the team grant
    const teamRow = within(rows[1]).getByText("frontend-team").closest("tr") as HTMLElement;
    expect((within(teamRow).getByLabelText("Role") as HTMLSelectElement).value).toBe("write");
    expect(within(teamRow).getByRole("button", { name: "Save" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add people or teams" })).not.toBeNull();

    // Saving the same role again creates no second record.
    await user.click(screen.getByRole("button", { name: "Add people or teams" }));
    await user.click(screen.getByRole("option", { name: "frontend-team" }));
    await user.selectOptions(pickerRole(), "write");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const reloaded = await grantTable();
    expect(within(reloaded).getAllByRole("row")).toHaveLength(2);
    expect(within(reloaded).getAllByText("frontend-team")).toHaveLength(1);
  });

  it("replaces the stored Write role with Read through the row Save button", async () => {
    const state = installAccess([
      {
        id: "grant-1",
        subjectType: "team",
        subjectId: "team-frontend-team",
        subjectName: "frontend-team",
        role: "write",
        createdAt: null,
      },
    ]);
    const user = userEvent.setup();
    renderApp(`#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/settings/access`);

    const table = await grantTable();
    const row = within(table).getByText("frontend-team").closest("tr") as HTMLElement;
    const roleSelect = within(row).getByLabelText("Role") as HTMLSelectElement;
    expect(roleSelect.value).toBe("write");

    await user.selectOptions(roleSelect, "read");
    await user.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(state.grants).toHaveLength(1));
    expect(state.grants[0].role).toBe("read");

    const reloaded = await grantTable();
    await waitFor(() =>
      expect(
        (within(within(reloaded).getByText("frontend-team").closest("tr") as HTMLElement).getByLabelText(
          "Role",
        ) as HTMLSelectElement).value,
      ).toBe("read"),
    );
    expect(within(reloaded).getAllByText("frontend-team")).toHaveLength(1);
  });

  it("offers every repository role including Write", async () => {
    installAccess([]);
    const user = userEvent.setup();
    renderApp(`#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/settings/access`);

    await user.click(await screen.findByRole("button", { name: "Add people or teams" }));
    const roleSelect = pickerRole();
    expect([...roleSelect.options].map((option) => option.textContent)).toEqual([
      "Read",
      "Triage",
      "Write",
      "Maintain",
      "Admin",
    ]);
  });

  it("shows the grants without management controls to a viewer without Admin role", async () => {
    installAccess(
      [
        {
          id: "grant-1",
          subjectType: "account",
          subjectId: "acc-bob-reviewer",
          subjectName: "bob-reviewer",
          role: "write",
          createdAt: null,
        },
      ],
      "write",
    );
    renderApp(`#/repositories/${encodeURIComponent(ORG_NAME)}/${REPO_NAME}/settings/access`);

    const table = await grantTable();
    expect(within(table).getByText("bob-reviewer")).not.toBeNull();
    expect(within(table).queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();
  });
});
