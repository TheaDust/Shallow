import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

interface AccountFixture {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

const ALICE: AccountFixture = {
  id: "account-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  emailVerified: true,
};

interface FakeGrant {
  subjectType: "account" | "team";
  subjectId: string;
  name: string;
  role: string;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const CANDIDATES = [
  { type: "account" as const, id: "account-bob-reviewer", name: "bob-reviewer" },
  { type: "team" as const, id: "team-frontend-team", name: "frontend-team" },
];

/**
 * Minimal stand-in for the repository-access API of a private organization
 * repository the signed-in organization Owner administers.
 */
function installFetch(initialGrants: FakeGrant[] = []) {
  const grants = [...initialGrants];
  const repository = {
    id: "repo-acme-demo-acme-internal",
    name: "acme-internal",
    fullName: "acme-demo/acme-internal",
    owner: { type: "organization", login: "acme-demo" },
    visibility: "private",
    description: "Internal planning notes of the Acme Demo organization.",
    defaultBranch: "main",
    updatedAt: "2024-02-18T14:05:00.000Z",
    forkedFrom: null,
  };

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (path === "/api/session") return jsonResponse(200, { account: ALICE });
    if (path.startsWith("/api/search")) {
      return jsonResponse(200, { query: "", type: "repositories", repositories: [] });
    }
    if (path.startsWith("/api/organizations")) {
      return jsonResponse(200, { organizations: [] });
    }

    const accessMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/access$/);
    if (accessMatch) {
      const payload = {
        repository,
        viewer: { role: "admin", canAdminister: true },
        grants: grants.map((grant) => ({
          id: `${grant.subjectType}:${grant.subjectId}`,
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
          name: grant.name,
          role: grant.role,
        })),
        candidates: CANDIDATES,
      };
      if (method === "GET") return jsonResponse(200, payload);
      if (method === "POST") {
        const subjectId = String(body.subjectId ?? "");
        const candidate = CANDIDATES.find((entry) => entry.id === subjectId);
        if (!candidate) return jsonResponse(400, { error: "Access grant failed", fields: { subject: "No" } });
        const role = String(body.role ?? "");
        const existing = grants.find((grant) => grant.subjectId === subjectId);
        if (existing) existing.role = role;
        else grants.push({ subjectType: candidate.type, subjectId: candidate.id, name: candidate.name, role });
        return jsonResponse(existing ? 200 : 201, {
          grant: { id: subjectId, subjectType: candidate.type, subjectId, name: candidate.name, role },
        });
      }
    }

    const repositoryMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)$/);
    if (repositoryMatch) {
      return jsonResponse(200, {
        repository: {
          ...repository,
          branch: "main",
          entries: [{ type: "file", name: "README.md", path: "README.md" }],
          commits: [],
          permissions: { role: "admin", canAdminister: true },
        },
      });
    }

    return jsonResponse(404, { error: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { grants };
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
});

describe("repository access management", () => {
  it("opens the picker from Settings → Manage access and grants a team the Write role", async () => {
    const { grants } = installFetch();
    const user = userEvent.setup();
    renderAt("#/repos/acme-demo/acme-internal/settings");

    expect(await screen.findByRole("heading", { level: 2, name: "Repository settings" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Manage access" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Manage access" })).toBeTruthy();
    expect(screen.getByText("This repository has no direct access grants.")).toBeTruthy();

    const openPicker = screen.getByRole("button", { name: "Add people or teams" });
    await user.click(openPicker);
    // The opening button of the picker is hidden while the picker is active.
    expect(screen.queryByRole("button", { name: "Add people or teams" })).toBeNull();

    const search = screen.getByRole("textbox", { name: "Search" });
    await user.type(search, "frontend");
    const option = await screen.findByRole("option", { name: "frontend-team" });
    expect(within(option).getByRole("button", { name: "frontend-team" })).toBeTruthy();
    await user.click(within(option).getByRole("button", { name: "frontend-team" }));

    const role = screen.getByRole("combobox", { name: "Role" });
    expect(role.textContent).toBe("Write");
    await user.click(role);
    await user.click(screen.getByRole("option", { name: "Write" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    const row = await screen.findByRole("row", { name: /frontend-team/ });
    expect(within(row).getByRole("cell", { name: "frontend-team" })).toBeTruthy();
    expect((within(row).getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("write");
    expect(within(row).getByText("Write", { selector: "option" })).toBeTruthy();
    expect(grants).toHaveLength(1);
    // The picker is closed again and the opening entry is available.
    expect(screen.getByRole("button", { name: "Add people or teams" })).toBeTruthy();

    cleanup();
    renderAt("#/repos/acme-demo/acme-internal/settings/access");
    const reloadedRow = await screen.findByRole("row", { name: /frontend-team/ });
    expect((within(reloadedRow).getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe(
      "write",
    );
    expect(screen.getAllByRole("row", { name: /frontend-team/ })).toHaveLength(1);
    expect(grants).toHaveLength(1);
  });

  it("replaces the stored Write grant with Read and keeps a single row", async () => {
    const { grants } = installFetch([
      { subjectType: "team", subjectId: "team-frontend-team", name: "frontend-team", role: "write" },
    ]);
    const user = userEvent.setup();
    renderAt("#/repos/acme-demo/acme-internal/settings/access");

    const row = await screen.findByRole("row", { name: /frontend-team/ });
    const role = within(row).getByRole("combobox", { name: "Role" }) as HTMLSelectElement;
    expect(role.value).toBe("write");

    await user.selectOptions(role, "read");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(grants).toHaveLength(1);
    });
    expect(grants[0].role).toBe("read");

    cleanup();
    renderAt("#/repos/acme-demo/acme-internal/settings/access");
    const rows = await screen.findAllByRole("row", { name: /frontend-team/ });
    expect(rows).toHaveLength(1);
    expect((within(rows[0]).getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe(
      "read",
    );
    expect(screen.getByText("Read", { selector: "option" })).toBeTruthy();
  });

  it("filters the selectable subjects while the administrator types", async () => {
    installFetch();
    const user = userEvent.setup();
    renderAt("#/repos/acme-demo/acme-internal/settings/access");

    await user.click(await screen.findByRole("button", { name: "Add people or teams" }));
    const search = screen.getByRole("textbox", { name: "Search" });
    await user.type(search, "bob");
    expect(await screen.findByRole("option", { name: "bob-reviewer" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "frontend-team" })).toBeNull();

    await user.clear(search);
    await user.type(search, "frontend");
    expect(await screen.findByRole("option", { name: "frontend-team" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "bob-reviewer" })).toBeNull();

    await user.clear(search);
    await user.type(search, "nobody");
    expect(await screen.findByText("No matches")).toBeTruthy();
  });
});
