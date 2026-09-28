import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FileRecord {
  path: string;
  content: string;
}

interface RepoRecord {
  ownerType: "account" | "organization";
  ownerName: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
  files: FileRecord[];
  branches?: { name: string; protected: boolean }[];
  currentBranch?: string;
  commitCount?: number;
  source: { ownerType: "account" | "organization"; ownerName: string; name: string } | null;
  grants: { username: string; role: string }[];
}

interface Viewer {
  username: string;
  email: string;
}

const ALICE: Viewer = { username: "alice-dev", email: "alice.dev@example.test" };
const BOB: Viewer = { username: "bob-reviewer", email: "bob.reviewer@example.test" };

const UPDATED = "2026-09-20T10:00:00.000Z";

function seedRepos(): RepoRecord[] {
  return [
    {
      ownerType: "account",
      ownerName: "alice-dev",
      name: "acme-docs",
      description: "Documentation for Acme Demo",
      visibility: "public",
      defaultBranch: "main",
      updatedAt: UPDATED,
      files: [
        { path: "README.md", content: "# Acme Docs\n\nPublic documentation." },
        { path: "guide.md", content: "# Guide\n\nHow to use it." },
      ],
      branches: [{ name: "main", protected: false }],
      currentBranch: "main",
      commitCount: 1,
      source: null,
      grants: [],
    },
    {
      ownerType: "account",
      ownerName: "alice-dev",
      name: "secret-research",
      description: "Confidential research notes",
      visibility: "private",
      defaultBranch: "main",
      updatedAt: UPDATED,
      files: [{ path: "README.md", content: "# Secret Research\n\nPrivate notes." }],
      branches: [{ name: "main", protected: false }],
      currentBranch: "main",
      commitCount: 1,
      source: null,
      grants: [{ username: "bob-reviewer", role: "read" }],
    },
    {
      ownerType: "account",
      ownerName: "alice-dev",
      name: "acme-docs-fork",
      description: "Existing fork name used for the conflict case",
      visibility: "private",
      defaultBranch: "main",
      updatedAt: UPDATED,
      files: [{ path: "README.md", content: "# Fork\n\nConflict seed." }],
      branches: [{ name: "main", protected: false }],
      currentBranch: "main",
      commitCount: 1,
      source: null,
      grants: [],
    },
    {
      ownerType: "organization",
      ownerName: "acme-demo",
      name: "acme-docs",
      description: "Documentation for Acme Demo",
      visibility: "public",
      defaultBranch: "main",
      updatedAt: UPDATED,
      files: [{ path: "README.md", content: "# Acme Docs\n\nOrg docs." }],
      branches: [{ name: "main", protected: false }],
      currentBranch: "main",
      commitCount: 1,
      source: null,
      grants: [],
    },
    {
      ownerType: "organization",
      ownerName: "acme-demo",
      name: "acme-internal",
      description: "Internal plans for Acme Demo",
      visibility: "private",
      defaultBranch: "main",
      updatedAt: UPDATED,
      files: [{ path: "README.md", content: "# Internal\n\nPlans." }],
      branches: [{ name: "main", protected: false }],
      currentBranch: "main",
      commitCount: 1,
      source: null,
      grants: [],
    },
  ];
}

function orgRole(viewer: Viewer | null, orgName: string): "owner" | "member" | null {
  if (orgName !== "acme-demo") return null;
  if (viewer?.username === "alice-dev") return "owner";
  if (viewer?.username === "bob-reviewer") return "member";
  return null;
}

function repoGrants(repo: RepoRecord): { username: string; role: string }[] {
  return repo.grants ?? [];
}

function effectiveRole(repo: RepoRecord, viewer: Viewer | null): string | null {
  if (!viewer) return null;
  if (repo.ownerType === "account" && repo.ownerName === viewer.username) return "admin";
  if (repo.ownerType === "organization") {
    const role = orgRole(viewer, repo.ownerName);
    if (role === "owner") return "admin";
  }
  const grant = repoGrants(repo).find((candidate) => candidate.username === viewer.username);
  if (grant) return grant.role;
  return null;
}

function canRead(repo: RepoRecord, viewer: Viewer | null): boolean {
  if (repo.visibility === "public") return true;
  return effectiveRole(repo, viewer) !== null;
}

function detail(repo: RepoRecord, viewer: Viewer | null) {
  return {
    ownerType: repo.ownerType,
    ownerName: repo.ownerName,
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility,
    defaultBranch: repo.defaultBranch,
    updatedAt: repo.updatedAt,
    currentRole: effectiveRole(repo, viewer),
    files: repo.files,
    branches: repo.branches ?? [{ name: repo.defaultBranch, protected: false }],
    currentBranch: repo.currentBranch ?? repo.defaultBranch,
    commitCount: repo.commitCount ?? 0,
    source: repo.source,
  };
}

function findRepo(repos: RepoRecord[], ownerType: string, ownerName: string, name: string) {
  return repos.find(
    (candidate) =>
      candidate.ownerType === ownerType && candidate.ownerName === ownerName && candidate.name === name,
  );
}

/**
 * Stateful fetch stub simulating the repository server: visibility-scoped
 * search, personal/org repo detail, forks, and visibility changes.
 */
function repoFetchHandler(
  repos: RepoRecord[],
  options: { initialSession?: Viewer | null } = {},
) {
  let viewer: Viewer | null = options.initialSession ?? null;
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
      return jsonResponse(401, { error: "Invalid credentials" });
    }
    if (path === "/api/sessions/current" && method === "DELETE") {
      viewer = null;
      return jsonResponse(200, { ok: true });
    }
    if (path.startsWith("/api/search/repositories")) {
      const query = new URL(path, "http://local").searchParams.get("q") ?? "";
      const matches = repos
        .filter((repo) => repo.name.toLowerCase().includes(query.trim().toLowerCase()))
        .filter((repo) => canRead(repo, viewer))
        .map((repo) => detail(repo, viewer));
      return jsonResponse(200, { repositories: matches });
    }
    const userRepos = path.match(/^\/api\/users\/([^/]+)\/repos$/);
    if (userRepos && method === "GET") {
      const matches = repos
        .filter((repo) => repo.ownerType === "account" && repo.ownerName === userRepos[1])
        .filter((repo) => canRead(repo, viewer))
        .map((repo) => detail(repo, viewer));
      return jsonResponse(200, { repositories: matches });
    }
    const userRepo = path.match(/^\/api\/users\/([^/]+)\/repos\/([^/?]+)(?:\?.*)?$/);
    if (userRepo && (method === "GET" || method === "PATCH")) {
      const repo = findRepo(repos, "account", userRepo[1], userRepo[2]);
      if (!repo) return jsonResponse(404, { error: "Not found" });
      if (method === "PATCH") {
        if (effectiveRole(repo, viewer) !== "admin") {
          return jsonResponse(403, { error: "Access denied" });
        }
        const body = JSON.parse(String(init.body)) as { visibility: string };
        repo.visibility = body.visibility === "public" ? "public" : "private";
        return jsonResponse(200, { ok: true });
      }
      if (!canRead(repo, viewer)) return jsonResponse(403, { error: "Access denied" });
      return jsonResponse(200, { repository: detail(repo, viewer) });
    }
    const orgRepo = path.match(/^\/api\/orgs\/([^/]+)\/repos\/([^/?]+)(?:\?.*)?$/);
    if (orgRepo && method === "GET") {
      const repo = findRepo(repos, "organization", orgRepo[1], orgRepo[2]);
      if (!repo) return jsonResponse(404, { error: "Not found" });
      if (!canRead(repo, viewer)) return jsonResponse(403, { error: "Access denied" });
      return jsonResponse(200, { repository: detail(repo, viewer) });
    }
    if (path === "/api/repositories" && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const body = JSON.parse(String(init.body)) as {
        ownerType: "account" | "organization";
        owner: string;
        name: string;
        description: string;
        visibility: string;
        initReadme: boolean;
      };
      const targetAllowed =
        body.ownerType === "account"
          ? body.owner === viewer.username
          : orgRole(viewer, body.owner) === "owner";
      if (!targetAllowed) return jsonResponse(403, { error: "Access denied" });
      const targetName = body.name.trim();
      const nameInvalid = !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(targetName) || targetName.length > 100;
      const nameConflict = repos.some(
        (repo) =>
          repo.ownerType === body.ownerType &&
          repo.ownerName === body.owner &&
          repo.name === targetName,
      );
      const visibilityInvalid = body.visibility !== "public" && body.visibility !== "private";
      if (nameInvalid) {
        return jsonResponse(400, { errors: { name: "Repository name format is invalid" } });
      }
      if (nameConflict) {
        return jsonResponse(400, { errors: { name: "Repository name already exists" } });
      }
      if (visibilityInvalid) {
        return jsonResponse(400, { errors: { visibility: "Visibility is invalid" } });
      }
      const created: RepoRecord = {
        ownerType: body.ownerType,
        ownerName: body.owner,
        name: targetName,
        description: body.description.trim(),
        visibility: body.visibility === "public" ? "public" : "private",
        defaultBranch: "main",
        updatedAt: UPDATED,
        files: body.initReadme
          ? [{ path: "README.md", content: `# ${targetName}\n` }]
          : [],
        branches: [{ name: "main", protected: false }],
        currentBranch: "main",
        commitCount: body.initReadme ? 1 : 0,
        source: null,
        grants: [],
      };
      repos.push(created);
      return jsonResponse(201, { repository: detail(created, viewer) });
    }
    if (path === "/api/forks" && method === "POST") {
      if (!viewer) return jsonResponse(401, { error: "Unauthenticated" });
      const body = JSON.parse(String(init.body)) as {
        sourceOwnerType: "account" | "organization";
        sourceOwner: string;
        sourceRepo: string;
        targetOwnerType: "account" | "organization";
        targetOwner: string;
        name: string;
        visibility: string;
      };
      const source = findRepo(repos, body.sourceOwnerType, body.sourceOwner, body.sourceRepo);
      if (!source || !canRead(source, viewer)) {
        return jsonResponse(403, { error: "Access denied" });
      }
      const targetExists =
        body.targetOwnerType === "account"
          ? body.targetOwner === viewer.username
          : orgRole(viewer, body.targetOwner) === "owner";
      if (!targetExists) return jsonResponse(403, { error: "Access denied" });
      const targetName = body.name.trim();
      const nameConflict = repos.some(
        (repo) =>
          repo.ownerType === body.targetOwnerType &&
          repo.ownerName === body.targetOwner &&
          repo.name === targetName,
      );
      if (nameConflict) {
        return jsonResponse(400, { errors: { name: "Repository name already exists" } });
      }
      const visibility = source.visibility === "private" ? "private" : body.visibility;
      const created: RepoRecord = {
        ownerType: body.targetOwnerType,
        ownerName: body.targetOwner,
        name: targetName,
        description: source.description,
        visibility: visibility === "public" ? "public" : "private",
        defaultBranch: source.defaultBranch,
        updatedAt: UPDATED,
        files: source.files.map((file) => ({ ...file })),
        branches: [{ name: source.defaultBranch, protected: false }],
        currentBranch: source.defaultBranch,
        commitCount: 1,
        source: { ownerType: source.ownerType, ownerName: source.ownerName, name: source.name },
        grants: [],
      };
      repos.push(created);
      return jsonResponse(201, { repository: detail(created, viewer) });
    }
    if (path === "/api/orgs" && method === "GET") {
      return jsonResponse(200, {
        organizations: [
          { name: "acme-demo", displayName: "Acme Demo", role: orgRole(viewer, "acme-demo") },
        ],
      });
    }
    return jsonResponse(404, { error: "Not found" });
  };
}

function stubFetch(handler: (path: string, init: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path =
        typeof input === "string" ? input : new URL(String(input)).pathname;
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

describe("REQ-3-1 search for and locate repositories", () => {
  it("a visitor searches from the home page, sees the public match with metadata and no private repo, and opens the overview", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });

    const searchbox = screen.getByRole("searchbox", { name: "Search" });
    await user.type(searchbox, "acme-docs");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "Search results" })).toBeTruthy();
    // Repository results are visible directly after Enter.
    const resultLinks = screen.getAllByRole("link", { name: "acme-docs" });
    expect(resultLinks.length).toBeGreaterThan(0);
    expect(screen.getByText("alice-dev/acme-docs")).toBeTruthy();
    expect(screen.getAllByText("Documentation for Acme Demo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Public").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Updated /).length).toBeGreaterThan(0);
    // No private repo result link.
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();
    expect(screen.queryByRole("link", { name: "acme-docs-fork" })).toBeNull();
    expect(screen.queryByRole("link", { name: "acme-internal" })).toBeNull();

    // Selecting the “Repositories” type filter keeps repository results.
    const typeSelect = screen.getByRole("combobox", { name: "Type" });
    await user.selectOptions(typeSelect, "repositories");
    expect(screen.getByRole("option", { name: "Repositories" })).toBeTruthy();
    expect(screen.getByText("alice-dev/acme-docs")).toBeTruthy();

    // A non-matching filter retains no old results.
    await user.selectOptions(typeSelect, "issues");
    expect(screen.getByText("No results")).toBeTruthy();
    expect(screen.queryByText("alice-dev/acme-docs")).toBeNull();
    await user.selectOptions(typeSelect, "repositories");

    // Clicking the public repository's name opens its overview.
    const aliceDocs = resultLinks.find((link) => (link as HTMLAnchorElement).href.includes("/u/alice-dev"));
    await user.click(aliceDocs as HTMLElement);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // Reload keeps the overview heading.
    cleanup();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
  });

  it("an unmatched query shows exactly No results, and clearing the term retains nothing", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "no-such-repository");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /acme|secret|fork|internal/ })).toBeNull();

    // Clearing the search term on the results page shows no old results.
    const resultsSearch = screen.getByRole("searchbox", { name: "Search" });
    await user.clear(resultsSearch);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByText("alice-dev/acme-docs")).toBeNull();

    // Repeating the same unmatched query from home still shows No results.
    window.location.hash = "#/";
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "no-such-repository");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No results")).toBeTruthy();
  });

  it("searching the private name exposes no result link for a visitor, and the private page is denied", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "secret-research");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No results")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "secret-research" })).toBeNull();

    window.location.hash = "#/u/alice-dev/repos/secret-research";
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
  });

  it("a signed-in authorized user sees the private repository in search results", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "secret-research");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("link", { name: "secret-research" })).toBeTruthy();
    expect(screen.getByText("alice-dev/secret-research")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
  });
});

describe("REQ-3-3 view a public repository overview", () => {
  it("a visitor opens the seeded public repository directly and browses a file", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    render(<App />);

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Documentation for Acme Demo")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pull requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "guide.md" })).toBeTruthy();
    // The Code button (clone menu) is distinct from the Code navigation link.
    expect(screen.getByRole("button", { name: "Code" })).toBeTruthy();
    // A visitor has no Fork or Settings controls.
    expect(screen.queryByRole("button", { name: "Fork" })).toBeNull();

    await userEvent.setup().click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText(/Public documentation/)).toBeTruthy();
  });
});

describe("REQ-3-2-2 fork a repository into another namespace", () => {
  it("the signed-in workspace lists the user's repositories so the fork source can be opened", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    // The workspace exposes the user's repositories as exact-name links.
    const docsLink = screen.getByRole("link", { name: "acme-docs" });
    expect((docsLink as HTMLAnchorElement).href).toContain("/u/alice-dev/repos/acme-docs");
    expect(screen.getByRole("link", { name: "secret-research" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme-docs-fork" })).toBeTruthy();

    await user.click(docsLink);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fork" })).toBeTruthy();
  });

  it("alice forks her public repository into her personal namespace with a new name", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "acme-docs");
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Search results" });
    const links = screen.getAllByRole("link", { name: "acme-docs" });
    await user.click(links.find((link) => (link as HTMLAnchorElement).href.includes("/u/alice-dev")) as HTMLElement);

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    const forkButton = screen.getByRole("button", { name: "Fork" });
    await user.click(forkButton);

    expect(await screen.findByRole("textbox", { name: "Repository name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create fork" })).toBeTruthy();
    const ownerSelect = screen.getByRole("combobox", { name: "Owner" });
    expect(screen.getByRole("option", { name: "alice-dev" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "acme-demo" })).toBeTruthy();
    expect((ownerSelect as HTMLSelectElement).value).toBe("account:alice-dev");
    expect(screen.getByRole("radio", { name: "Public" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Private" })).toBeTruthy();

    await user.clear(screen.getByRole("textbox", { name: "Repository name" }));
    await user.type(screen.getByRole("textbox", { name: "Repository name" }), "acme-docs-copy");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs-copy" })).toBeTruthy();
    const forkedLine = screen.getByText((_content, element) => element?.classList.contains("repo-overview__forked") ?? false);
    expect(forkedLine.textContent).toBe("Forked from acme-docs");
    const sourceLink = screen.getByRole("link", { name: "acme-docs" });
    expect((sourceLink as HTMLAnchorElement).href).toContain("/u/alice-dev/repos/acme-docs");
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "guide.md" })).toBeTruthy();

    // The target owner's repository list still shows the fork with the source link.
    window.location.hash = "#/u/alice-dev";
    expect(await screen.findByRole("link", { name: "acme-docs-copy" })).toBeTruthy();
  });

  it("a conflicting fork name keeps the form open with a field error and creates nothing", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/fork";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("textbox", { name: "Repository name" });

    await user.clear(screen.getByRole("textbox", { name: "Repository name" }));
    await user.type(screen.getByRole("textbox", { name: "Repository name" }), "acme-docs-fork");
    await user.click(screen.getByRole("button", { name: "Create fork" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Repository name" })).toBeTruthy();
    expect(window.location.hash).toBe("#/u/alice-dev/repos/acme-docs/fork");
    expect(screen.queryByRole("link", { name: "acme-docs-fork" })).toBeNull();
  });

  it("a visitor cannot fork; the form asks to sign in", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs/fork";
    render(<App />);
    expect(await screen.findByText("Sign in to fork this repository.")).toBeTruthy();
  });
});

describe("REQ-3-4 change repository visibility with permission checks", () => {
  it("the Admin changes the private repository to Public through Settings > General > Danger Zone", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    window.location.hash = "#/u/alice-dev/repos/secret-research";
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("link", { name: "General" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Danger Zone" })).toBeTruthy();
    const changeButton = screen.getByRole("button", { name: "Change visibility" });
    await user.click(changeButton);

    const dialog = screen.getByRole("dialog", { name: "Change visibility" });
    expect(within(dialog).getByRole("radio", { name: "Private" })).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "Public" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /repository name/i })).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "Public" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change visibility" })).toBeNull());
    expect(await screen.findByText("Visibility updated")).toBeTruthy();

    // The overview shows the Public marker after refresh.
    window.location.hash = "#/u/alice-dev/repos/secret-research";
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(await screen.findByText("Public")).toBeTruthy();

    // An unauthenticated visitor can now open the same address.
    cleanup();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // The settings page keeps the new visibility after reload.
    window.location.hash = "#/u/alice-dev/repos/secret-research/settings";
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(await screen.findByText("Visibility:")).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("confirming with Private selected leaves the repository Private", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/u/alice-dev/repos/secret-research/settings";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/secret-research" });
    await screen.findByRole("button", { name: "Change visibility" });

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = screen.getByRole("dialog", { name: "Change visibility" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change visibility" })).toBeNull());

    window.location.hash = "#/u/alice-dev/repos/secret-research";
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(await screen.findByText("Private")).toBeTruthy();
  });

  it("a non-Admin collaborator sees the Settings link but no Change visibility button", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: BOB }));
    window.location.hash = "#/u/alice-dev/repos/secret-research";
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Danger Zone" });
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
  });
});

describe("REQ-3-2-1 create a repository with owner, visibility, and initialization options", () => {
  it("alice creates an initialized private repository from the workspace New repository link", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Workspace" });

    const newRepoLink = screen.getByRole("link", { name: "New repository" });
    await user.click(newRepoLink);

    expect(await screen.findByRole("heading", { name: "Create a new repository" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Repository name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
    const ownerSelect = screen.getByRole("combobox", { name: "Owner" });
    expect(screen.getByRole("option", { name: "alice-dev" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "acme-demo" })).toBeTruthy();
    // The personal namespace is selected by default: submission needs no owner change.
    expect((ownerSelect as HTMLSelectElement).value).toBe("account:alice-dev");
    expect(screen.getByRole("radio", { name: "Public" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Private" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Add a README file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create repository" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Repository name" }), "playwright-repo");
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Repository created by Playwright",
    );
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    // The new repository's overview opens with the Private marker and a README link.
    expect(await screen.findByRole("heading", { name: "alice-dev/playwright-repo" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText("Repository created by Playwright")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();

    // Reload keeps the overview heading, visibility, and README.
    cleanup();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/playwright-repo" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // The repository appears in the target owner's repository list.
    window.location.hash = "#/u/alice-dev";
    expect(await screen.findByRole("link", { name: "playwright-repo" })).toBeTruthy();
    expect(screen.getByText("Repository created by Playwright")).toBeTruthy();
  });

  it("a duplicate name in the default personal namespace keeps the form open and creates nothing", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/repos/new";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Create a new repository" });

    await user.type(screen.getByRole("textbox", { name: "Repository name" }), "acme-docs");
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name already exists")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Create a new repository" })).toBeTruthy();
    expect(window.location.hash).toBe("#/repos/new");
    // The existing repository's overview heading is never opened.
    expect(screen.queryByRole("heading", { name: "alice-dev/acme-docs" })).toBeNull();
  });

  it("an empty name shows the format reason and leaves the original state unchanged", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/repos/new";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Create a new repository" });

    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByText("Repository name format is invalid")).toBeTruthy();
    expect(window.location.hash).toBe("#/repos/new");
    const beforeCount = repos.filter((repo) => repo.ownerName === "alice-dev").length;
    expect(beforeCount).toBe(3);
  });

  it("an organization Owner creates a repository in the organization namespace", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: ALICE }));
    window.location.hash = "#/repos/new";
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Create a new repository" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Owner" }), "organization:acme-demo");
    await user.type(screen.getByRole("textbox", { name: "Repository name" }), "org-notes");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    expect(await screen.findByRole("heading", { name: "acme-demo/org-notes" })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
  });

  it("a visitor has no New repository link and the direct creation page asks to sign in", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    render(<App />);
    await screen.findByRole("heading", { name: "GitHub Collaboration Platform" });
    expect(screen.queryByRole("link", { name: "New repository" })).toBeNull();

    window.location.hash = "#/repos/new";
    expect(await screen.findByText("Sign in to create a repository.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
  });
});

describe("REQ-3-2-3 copy a repository clone value", () => {
  function stubClipboard(): { writes: string[]; writeText: ReturnType<typeof vi.fn> } {
    const writes: string[] = [];
    const writeText = vi.fn(async (text: string) => {
      writes.push(text);
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return { writes, writeText };
  }

  it("a visitor copies the HTTPS and SSH clone values of a public repository", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: null }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs";
    const user = userEvent.setup();
    // Stub after userEvent.setup(): setup() replaces navigator.clipboard itself.
    const { writes, writeText } = stubClipboard();
    render(<App />);
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    await user.click(screen.getByRole("button", { name: "Code" }));
    const dialog = screen.getByRole("dialog", { name: "Clone" });
    expect(within(dialog).getByRole("tab", { name: "HTTPS" })).toBeTruthy();
    expect(within(dialog).getByRole("tab", { name: "SSH" })).toBeTruthy();
    // HTTPS is the default protocol and uses the HTTPS scheme with .git suffix.
    expect(within(dialog).getByRole("tab", { name: "HTTPS" }).getAttribute("aria-selected")).toBe("true");
    const httpsValue = `https://${window.location.host}/alice-dev/acme-docs.git`;
    expect((within(dialog).getByLabelText("Clone address") as HTMLInputElement).value).toBe(httpsValue);

    await user.click(within(dialog).getByRole("button", { name: "Copy clone value" }));
    expect(await screen.findByRole("status", { name: "Copied" })).toBeTruthy();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(httpsValue));
    // The repository heading stays visible while the menu is open.
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    // Switching to SSH shows the SSH format with the colon and .git suffix.
    await user.click(within(dialog).getByRole("tab", { name: "SSH" }));
    const sshValue = `git@${window.location.host}:alice-dev/acme-docs.git`;
    expect((within(dialog).getByLabelText("Clone address") as HTMLInputElement).value).toBe(sshValue);
    await user.click(within(dialog).getByRole("button", { name: "Copy clone value" }));
    expect(await screen.findByRole("status", { name: "Copied" })).toBeTruthy();
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(sshValue));

    // Closing and reopening the menu keeps the selected protocol and the heading.
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Clone" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Code" }));
    const reopened = screen.getByRole("dialog", { name: "Clone" });
    expect(within(reopened).getByRole("tab", { name: "SSH" }).getAttribute("aria-selected")).toBe("true");
    expect((within(reopened).getByLabelText("Clone address") as HTMLInputElement).value).toBe(sshValue);
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs" })).toBeTruthy();

    // The read-only copy operation changed no repository state.
    const docs = findRepo(repos, "account", "alice-dev", "acme-docs");
    expect(docs?.visibility).toBe("public");
    expect(docs?.files.map((file) => file.path)).toEqual(["README.md", "guide.md"]);
    expect(writes).toEqual([httpsValue, sshValue]);
  });

  it("a signed-in user without access cannot reach a private repository or its clone value", async () => {
    const repos = seedRepos();
    stubFetch(repoFetchHandler(repos, { initialSession: BOB }));
    window.location.hash = "#/u/alice-dev/repos/acme-docs-fork";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs-fork" })).toBeTruthy();
    expect(await screen.findByText("Access denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Code" })).toBeNull();
  });
});
