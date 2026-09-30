import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

/**
 * In-memory stand-in for the branch protection API (REQ-6-1). The repository
 * `alice-dev/acme-docs` holds the branches `main`, `feature-search` and
 * `release`; a stored rule is bound to one exact branch name and carries the two
 * independently selectable requirements. No rule exists until a scenario creates
 * one, and every save is refused for a viewer without administration permission.
 */

type Role = "read" | "triage" | "write" | "maintain" | "admin" | null;

const ALICE = {
  id: "account-alice-dev",
  username: "alice-dev",
  email: "alice.dev@example.test",
  emailVerified: true,
};
const CAROL = {
  id: "account-carol-dev",
  username: "carol-dev",
  email: "carol.dev@example.test",
  emailVerified: true,
};

interface StubRule {
  id: string;
  branchName: string;
  requireApproval: boolean;
  requireStatusCheck: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

interface Stub {
  account: typeof ALICE | null;
  role: Role;
  rules: StubRule[];
  writes: Array<{ method: string; path: string; body: Record<string, unknown> }>;
}

function initialStub(): Stub {
  return { account: null, role: null, rules: [], writes: [] };
}

function jsonResponse(status: number, body: unknown) {
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

const REPO = "/api/repositories/alice-dev/acme-docs";

function repositoryContext(stub: Stub) {
  return {
    id: "repo-alice-dev-acme-docs",
    name: "acme-docs",
    fullName: "alice-dev/acme-docs",
    ownerDisplayName: "alice-dev",
    owner: { type: "user", login: "alice-dev" },
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: "main",
    updatedAt: "2024-03-02T10:00:00.000Z",
    forkedFrom: null,
    branch: "main",
    branches: [
      { name: "main", headCommitId: "commit-main" },
      { name: "feature-search", headCommitId: "commit-feature" },
      { name: "release", headCommitId: "commit-release" },
    ],
    permissions: { role: stub.role, canAdminister: stub.role === "admin" },
  };
}

function rulePayload(rule: StubRule) {
  const summaries: string[] = [];
  if (rule.requireApproval) summaries.push("1 approval");
  if (rule.requireStatusCheck) summaries.push("Require status check test");
  return { ...rule, summaries };
}

function installFetch(stub: Stub) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;

    if (path === "/api/session") return jsonResponse(200, { account: stub.account });
    if (path === "/api/search") {
      return jsonResponse(200, { query: "", type: "repositories", repositories: [] });
    }
    if (path === "/api/namespaces") return jsonResponse(401, { error: "Not authenticated" });
    if (path === REPO && method === "GET") {
      return jsonResponse(200, { repository: repositoryContext(stub) });
    }
    if (path === `${REPO}/branch-protection` && method === "GET") {
      return jsonResponse(200, { repository: repositoryContext(stub), rules: stub.rules.map(rulePayload) });
    }
    if (path === `${REPO}/branch-protection` && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (stub.role !== "admin") {
        return jsonResponse(403, {
          error: "You must be a repository administrator to manage branch protection rules.",
        });
      }
      const branchName = String(body?.branchName ?? "").trim();
      if (!branchName) {
        return jsonResponse(400, {
          error: "Branch protection rule failed",
          fields: { branchName: "Branch name is required" },
        });
      }
      const existing = stub.rules.find((rule) => rule.branchName === branchName);
      if (existing) {
        existing.requireApproval = body?.requireApproval === true;
        existing.requireStatusCheck = body?.requireStatusCheck === true;
        existing.updatedBy = "alice-dev";
        existing.updatedAt = "2024-03-06T09:00:00.000Z";
      } else {
        stub.rules.push({
          id: `rule-${branchName}`,
          branchName,
          requireApproval: body?.requireApproval === true,
          requireStatusCheck: body?.requireStatusCheck === true,
          createdBy: "alice-dev",
          createdAt: "2024-03-06T09:00:00.000Z",
          updatedBy: "alice-dev",
          updatedAt: "2024-03-06T09:00:00.000Z",
        });
      }
      const saved = stub.rules.find((rule) => rule.branchName === branchName) as StubRule;
      return jsonResponse(existing ? 200 : 201, {
        repository: repositoryContext(stub),
        rule: rulePayload(saved),
        rules: stub.rules.map(rulePayload),
      });
    }
    if (path === `${REPO}/pulls` && method === "GET") {
      return jsonResponse(200, { repository: repositoryContext(stub), pullRequests: [] });
    }
    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

const BRANCHES_SETTINGS = "#/repos/alice-dev/acme-docs/settings/branches";

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("branch protection rules under Settings → Branches", () => {
  it("creates exactly one rule for main with both requirements and keeps it after a reload", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    installFetch(stub);
    const user = userEvent.setup();

    open(BRANCHES_SETTINGS);
    await screen.findByRole("heading", { name: "Branches" });
    expect(await screen.findByText("No branch protection rules.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add branch protection rule" }));

    const form = screen.getByRole("form", { name: "Branch protection rule" });
    const fields = within(form);
    await user.type(fields.getByLabelText("Branch name pattern"), "main");
    await user.click(fields.getByRole("checkbox", { name: "Require 1 approval" }));
    await user.click(fields.getByRole("checkbox", { name: "Require status check test" }));
    await user.click(fields.getByRole("button", { name: "Create" }));

    // The form closes and the stored rule is displayed with its exact branch name
    // and the summaries of both requirements.
    expect(await screen.findByText("Branch protection rule saved.")).toBeTruthy();
    const row = screen.getByText("main", { selector: ".branch-protection__branch" }).closest("li");
    const stored = within(row as HTMLElement);
    expect(stored.getByText("1 approval")).toBeTruthy();
    expect(stored.getByText("Require status check test")).toBeTruthy();
    expect(stub.rules.length).toBe(1);

    // Reloading the settings page reads the same stored rule.
    cleanup();
    open(BRANCHES_SETTINGS);
    const reloaded = await screen.findByText("1 approval");
    expect(reloaded).toBeTruthy();
    expect(screen.getByText("Require status check test")).toBeTruthy();
    expect(screen.queryByText("No branch protection rules.")).toBeNull();
  });

  it("saves the changed toggles of an existing rule with Save changes", async () => {
    const stub = initialStub();
    stub.account = ALICE;
    stub.role = "admin";
    stub.rules.push({
      id: "rule-main",
      branchName: "main",
      requireApproval: true,
      requireStatusCheck: true,
      createdBy: "alice-dev",
      createdAt: "2024-03-01T09:00:00.000Z",
      updatedBy: "alice-dev",
      updatedAt: "2024-03-01T09:00:00.000Z",
    });
    installFetch(stub);
    const user = userEvent.setup();

    open(BRANCHES_SETTINGS);
    await screen.findByText("1 approval");

    await user.click(screen.getByRole("button", { name: "Edit rule for main" }));    const form = screen.getByRole("form", { name: "Branch protection rule" });
    expect((within(form).getByLabelText("Branch name pattern") as HTMLInputElement).value).toBe(
      "main",
    );
    expect(
      (within(form).getByRole("checkbox", { name: "Require status check test" }) as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.click(within(form).getByRole("checkbox", { name: "Require status check test" }));
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("1 approval")).toBeTruthy();
    expect(screen.queryByText("Require status check test")).toBeNull();
    expect(stub.rules[0].requireStatusCheck).toBe(false);
  });

  it("offers no rule-editing entry to a non-admin", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    stub.role = "write";
    stub.rules.push({
      id: "rule-main",
      branchName: "main",
      requireApproval: true,
      requireStatusCheck: true,
      createdBy: "alice-dev",
      createdAt: "2024-03-01T09:00:00.000Z",
      updatedBy: "alice-dev",
      updatedAt: "2024-03-01T09:00:00.000Z",
    });
    installFetch(stub);

    open(BRANCHES_SETTINGS);
    await screen.findByText("1 approval");

    expect(screen.queryByRole("button", { name: "Add branch protection rule" })).toBeNull();    expect(screen.queryByRole("form", { name: "Branch protection rule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit rule for main" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    // The existing rule stays readable, and no save was attempted.
    expect(screen.getByText("Require status check test")).toBeTruthy();
    expect(stub.writes).toEqual([]);
  });

  it("keeps the read-only settings page usable for a non-admin", async () => {
    const stub = initialStub();
    stub.account = CAROL;
    // The server refuses a save even if a rule-editing form were reachable.
    stub.role = "write";
    installFetch(stub);

    open(BRANCHES_SETTINGS);
    await screen.findByText("No branch protection rules.");
    expect(screen.queryByRole("button", { name: "Add branch protection rule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(stub.rules).toEqual([]);
  });
});
