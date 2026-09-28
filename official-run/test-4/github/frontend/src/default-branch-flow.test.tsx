import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FileRec {
  path: string;
  content: string;
}

interface CommitRec {
  id: string;
  parentId: string | null;
  authorName: string;
  message: string;
  createdAt: string;
  files: FileRec[];
}

interface BranchRec {
  name: string;
  commitId: string | null;
  protected: boolean;
}

interface RepoRec {
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  branches: BranchRec[];
  commits: CommitRec[];
}

const ALICE = { username: "alice-dev", email: "alice.dev@example.test" };
const BOB = { username: "bob-reviewer", email: "bob.reviewer@example.test" };

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const README_V1 = "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n";
const README_V2 =
  "# Acme Docs\n\nPublic documentation for the Acme Demo platform.\n\nThe search flow is documented in this repository.\n";
const GUIDE = "# Guide\n\nHow to use the Acme Demo platform.\n";
const SEARCH_V1 = "export function search(query: string) {\n  return query.trim();\n}\n";
const OVERVIEW = "# Overview\n\nGuides and reference material for the Acme Docs platform.\n";
const MAIN_ONLY = "# Main-only\n\nThis file exists only on the feature-search branch.\n";

function seedAcmeDocs(): RepoRec {
  const commitA: CommitRec = {
    id: "commit_aaaaaaaa",
    parentId: null,
    authorName: "alice-dev",
    message: "Initial commit",
    createdAt: daysAgo(5),
    files: [
      { path: "README.md", content: README_V1 },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
    ],
  };
  const commitB: CommitRec = {
    id: "commit_bbbbbbbb",
    parentId: commitA.id,
    authorName: "alice-dev",
    message: "Document search flow",
    createdAt: daysAgo(2),
    files: [
      { path: "README.md", content: README_V2 },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
      { path: "docs/overview.md", content: OVERVIEW },
    ],
  };
  const commitF: CommitRec = {
    id: "commit_ffffffff",
    parentId: commitA.id,
    authorName: "alice-dev",
    message: "Add feature search docs",
    createdAt: daysAgo(3),
    files: [
      { path: "README.md", content: README_V1 },
      { path: "guide.md", content: GUIDE },
      { path: "src/search.ts", content: SEARCH_V1 },
      { path: "main-only.md", content: MAIN_ONLY },
    ],
  };
  return {
    name: "acme-docs",
    description: "Documentation for Acme Demo",
    visibility: "public",
    defaultBranch: "main",
    updatedAt: daysAgo(1),
    branches: [
      { name: "main", commitId: commitB.id, protected: false },
      { name: "feature-search", commitId: commitF.id, protected: true },
      { name: "release", commitId: commitB.id, protected: false },
    ],
    commits: [commitA, commitB, commitF],
  };
}

function branchIds(repo: RepoRec, branchName: string): string[] {
  const branch = repo.branches.find((candidate) => candidate.name === branchName);
  if (!branch || !branch.commitId) return [];
  const ids: string[] = [];
  let cursor: string | null = branch.commitId;
  while (cursor) {
    const commit = repo.commits.find((candidate) => candidate.id === cursor);
    if (!commit) break;
    ids.push(commit.id);
    cursor = commit.parentId;
  }
  return ids;
}

function snapshot(repo: RepoRec, branchName: string): FileRec[] {
  const branch = repo.branches.find((candidate) => candidate.name === branchName);
  if (!branch || !branch.commitId) return [];
  const commit = repo.commits.find((candidate) => candidate.id === branch.commitId);
  return commit ? commit.files : [];
}

function repoDetail(repo: RepoRec, viewer: { username: string } | null, branch: string | null) {
  const current = branch ?? repo.defaultBranch;
  return {
    ownerType: "account",
    ownerName: "alice-dev",
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility,
    defaultBranch: repo.defaultBranch,
    updatedAt: repo.updatedAt,
    currentRole: viewer?.username === "alice-dev" ? "admin" : null,
    files: snapshot(repo, current),
    branches: repo.branches.map((b) => ({ name: b.name, protected: b.protected })),
    currentBranch: current,
    commitCount: branchIds(repo, current).length,
    source: null,
  };
}

function fetchHandler(repos: RepoRec[], options: { initialSession?: { username: string; email: string } | null } = {}) {
  let viewer: { username: string; email: string } | null = options.initialSession ?? null;
  return (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    if (path === "/api/sessions/current") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      return jsonResponse(200, { account: viewer });
    }
    if (path === "/api/sessions" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { identifier: string; password: string };
      if (
        (body.identifier === "alice-dev" || body.identifier === ALICE.email) &&
        body.password === "Valid-password-123!"
      ) {
        viewer = ALICE;
        return jsonResponse(201, { account: ALICE });
      }
      if (
        (body.identifier === "bob-reviewer" || body.identifier === BOB.email) &&
        body.password === "Valid-password-123!"
      ) {
        viewer = BOB;
        return jsonResponse(201, { account: BOB });
      }
      return jsonResponse(401, { error: "Invalid credentials" });
    }
    const url = new URL(path, "http://local");
    const route = url.pathname;
    const repo = repos[0];

    const detailMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs$/);
    if (detailMatch && method === "GET") {
      return jsonResponse(200, { repository: repoDetail(repo, viewer, url.searchParams.get("branch")) });
    }
    const defaultBranchMatch = route.match(/^\/api\/users\/alice-dev\/repos\/acme-docs\/default-branch$/);
    if (defaultBranchMatch && method === "PATCH") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      if (viewer.username !== "alice-dev") return jsonResponse(403, { error: "Access denied" });
      const body = JSON.parse(String(init.body)) as { branch: string };
      if (!repo.branches.some((branch) => branch.name === body.branch)) {
        return jsonResponse(400, { errors: { branch: "Branch not found" } });
      }
      repo.defaultBranch = body.branch;
      repo.updatedAt = new Date().toISOString();
      return jsonResponse(200, { repository: repoDetail(repo, viewer, null) });
    }
    return jsonResponse(404, { error: "Not found" });
  };
}

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : new URL(String(input)).pathname;
      return handler(path, init ?? {});
    }),
  );
}

beforeEach(() => {
  window.location.hash = "#/";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("an Admin selects release, confirms, and the repository opens on the new default while main stays selectable", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/settings/branches";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    // The native select exposes the combobox role with branch-name options.
    const select = screen.getByRole("combobox", { name: "Default branch" }) as HTMLSelectElement;
    expect(select.value).toBe("main");
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "main",
      "feature-search",
      "release",
    ]);

    // Selecting release and activating Update opens the confirmation dialog.
    await user.selectOptions(select, "release");
    await user.click(screen.getByRole("button", { name: "Update" }));
    const dialog = await screen.findByRole("dialog", { name: "Change default branch" });
    expect(dialog.textContent).toContain("main");
    expect(dialog.textContent).toContain("release");

    // Confirming persists the change and closes the dialog.
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryByRole("dialog", { name: "Change default branch" })).toBeNull();
    expect(await screen.findByText("Default branch updated")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Default branch" }) as HTMLSelectElement).value).toBe(
      "release",
    );
    expect(repos[0].defaultBranch).toBe("release");

    // Opening the repository without a branch shows the new default branch;
    // the selector still offers the old default branch.
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    expect(await screen.findByRole("button", { name: "Branch release" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Branch release" }));
    expect(await screen.findByRole("textbox", { name: "Find branch" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "release" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    await user.keyboard("{Escape}");

    // Refreshing the settings page keeps the persisted default branch.
    window.location.hash = "#/u/alice-dev/repos/acme-docs/settings/branches";
    expect(await screen.findByRole("combobox", { name: "Default branch" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Default branch" }) as HTMLSelectElement).value).toBe(
      "release",
    );

    // The old default branch was not deleted.
    expect(repos[0].branches.some((branch) => branch.name === "main")).toBe(true);
  });

  it("a non-Admin sees no Default branch combobox or update button and the value stays unchanged", async () => {
    const repos = [seedAcmeDocs()];
    stubFetch(fetchHandler(repos, { initialSession: BOB }));
    const user = userEvent.setup();
    window.location.hash = "#/u/alice-dev/repos/acme-docs/settings/branches";
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.getByText("Only repository Admins can change the default branch.")).toBeTruthy();
    expect(screen.getByText("main", { selector: ".repo-overview__branch" })).toBeTruthy();

    // The Branches entry stays reachable from the General settings page.
    await user.click(screen.getByRole("link", { name: "General" }));
    expect(await screen.findByRole("link", { name: "Branches" })).toBeTruthy();
    expect(repos[0].defaultBranch).toBe("main");
  });
});
