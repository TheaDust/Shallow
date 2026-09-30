import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { repositoryBlobHref, repositoryEditorHref, repositoryTreeHref } from "./lib/repository-routes";

/**
 * In-memory stand-in for the code and version-control API of the seeded
 * `alice-dev/acme-docs`: `main` and `release` carry `README.md`, `docs/README.md`
 * and `src/search.ts`, while `feature-search` carries a different `README.md`
 * and the file `main-only.md` that `main` does not have. Every write is validated
 * like the server validates it, so a refused submission is visible as the same
 * field error.
 */
const README_MAIN =
  "# acme-docs\n\nDocumentation and guides for the Acme platform.\n\n## Search flow\n\nFollow the search flow.\n";
const README_FEATURE = "# acme-docs\n\nOnboarding notes for new contributors.\n";
const MAIN_ONLY = "# Main-only notes\n\nThis note file exists only on the feature-search branch.\n";
const DOCS_README = "# Getting started\n\nRun the setup command to create your first workspace.\n";
const SEARCH_TS = "// Search flow helpers\nexport function searchFlow(): void {}\n";
const DOCS_PATH = "docs/README.md";

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
const READER: AccountFixture = {
  id: "account-outsider-reader",
  username: "outsider-reader",
  email: "outsider.reader@example.test",
  emailVerified: true,
};

interface StubCommit {
  id: string;
  shortId: string;
  message: string;
  author: string;
  createdAt: string;
  parentId: string | null;
  changedFiles: string[];
}

const INITIAL: StubCommit = {
  id: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  shortId: "1a2b3c4",
  message: "Initial commit",
  author: "alice-dev",
  createdAt: "2024-01-05T09:00:00.000Z",
  parentId: null,
  changedFiles: ["README.md"],
};
const DOCUMENT_SEARCH: StubCommit = {
  id: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
  shortId: "9f8e7d6",
  message: "Document search flow",
  author: "alice-dev",
  createdAt: "2024-02-12T09:30:00.000Z",
  parentId: INITIAL.id,
  changedFiles: ["README.md", DOCS_PATH, "src/search.ts"],
};
const SEARCH_LOADER: StubCommit = {
  id: "3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a09",
  shortId: "3c2b1a0",
  message: "Add search loader",
  author: "alice-dev",
  createdAt: "2024-02-20T15:45:00.000Z",
  parentId: DOCUMENT_SEARCH.id,
  changedFiles: ["src/search.ts"],
};

type Role = "read" | "write" | "maintain" | "admin" | null;

interface Stub {
  account: AccountFixture | null;
  role: Role;
  canAdminister: boolean;
  branches: { name: string; headCommitId: string | null }[];
  defaultBranch: string;
  files: Record<string, Record<string, string>>;
  history: Record<string, StubCommit[]>;
  writes: Array<{ method: string; path: string; body: Record<string, unknown> }>;
}

function initialStub(): Stub {
  return {
    account: null,
    role: null,
    canAdminister: false,
    branches: [
      { name: "main", headCommitId: SEARCH_LOADER.id },
      { name: "feature-search", headCommitId: SEARCH_LOADER.id },
      { name: "release", headCommitId: DOCUMENT_SEARCH.id },
    ],
    defaultBranch: "main",
    files: {
      main: {
        "README.md": README_MAIN,
        [DOCS_PATH]: DOCS_README,
        "src/search.ts": SEARCH_TS,
      },
      "feature-search": { "README.md": README_FEATURE, "main-only.md": MAIN_ONLY },
      release: { "README.md": README_MAIN, [DOCS_PATH]: DOCS_README },
    },
    history: {
      main: [SEARCH_LOADER, DOCUMENT_SEARCH, INITIAL],
      "feature-search": [SEARCH_LOADER, DOCUMENT_SEARCH, INITIAL],
      release: [DOCUMENT_SEARCH, INITIAL],
    },
    writes: [],
  };
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

const REPO_PATH = "/api/repositories/alice-dev/acme-docs";

function summary(stub: Stub) {
  return {
    id: "repo-alice-dev-acme-docs",
    name: "acme-docs",
    fullName: "alice-dev/acme-docs",
    owner: { type: "user", login: "alice-dev" },
    visibility: "public",
    description: "Documentation and guides for the Acme platform.",
    defaultBranch: stub.defaultBranch,
    updatedAt: "2024-03-01T10:00:00.000Z",
    forkedFrom: null,
  };
}

function context(stub: Stub, branch: string) {
  return {
    ...summary(stub),
    branch,
    branches: stub.branches,
    permissions: { role: stub.role, canAdminister: stub.canAdminister },
  };
}

function entriesFor(files: Record<string, string>, directory: string) {
  const prefix = directory ? `${directory}/` : "";
  const entries = new Map<string, { type: "file" | "dir"; name: string; path: string }>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest) continue;
    const [name, ...tail] = rest.split("/");
    const type = tail.length > 0 ? "dir" : "file";
    if (type === "dir" || !entries.has(name)) entries.set(name, { type, name, path: `${prefix}${name}` });
  }
  return [...entries.values()].sort((left, right) =>
    left.type === right.type ? left.name.localeCompare(right.name) : left.type === "dir" ? -1 : 1,
  );
}

function directoryExists(files: Record<string, string>, directory: string) {
  if (!directory) return true;
  const prefix = `${directory}/`;
  if (Object.keys(files).some((path) => path.startsWith(prefix))) return true;
  const parent = directory.slice(0, directory.lastIndexOf("/"));
  return entriesFor(files, parent).some((entry) => entry.type === "dir" && entry.path === directory);
}

function canWrite(role: Role): boolean {
  return role === "write" || role === "maintain" || role === "admin";
}

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

function branchNameError(name: string, stub: Stub): string | null {
  const value = name.trim();
  if (!value || value.length > 255) return "Invalid branch";
  if (!BRANCH_PATTERN.test(value)) return "Invalid branch";
  if (value.endsWith("/") || value.endsWith(".")) return "Invalid branch";
  if (value.includes("..") || value.includes("//")) return "Invalid branch";
  if (stub.branches.some((branch) => branch.name === value)) return "Invalid branch";
  return null;
}

function filePathError(path: string, stub: Stub, branch: string, previousPath: string): string | null {
  const value = path.trim();
  if (value !== previousPath) {
    if (!value || value.startsWith("/")) return "Invalid file path";
    if (value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return "Invalid file path";
    }
    const files = stub.files[branch] ?? {};
    if (files[value] !== undefined) return "Invalid file path";
    if (Object.keys(files).some((existing) => existing.startsWith(`${value}/`))) {
      return "Invalid file path";
    }
    const segments = value.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (files[segments.slice(0, index).join("/")] !== undefined) return "Invalid file path";
    }
  } else if (!value) {
    return "Invalid file path";
  }
  return null;
}

function installFetch(stub: Stub) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;

    if (path === "/api/session") return jsonResponse(200, { account: stub.account });
    if (path === "/api/search") return jsonResponse(200, { query: "", type: "repositories", repositories: [] });
    if (path === "/api/namespaces") return jsonResponse(401, { error: "Not authenticated" });

    const fileMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/file$/);
    if (fileMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      const branch = String(body?.branch ?? "");
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!canWrite(stub.role)) {
        return jsonResponse(403, { error: "You need write permission to edit files in this repository." });
      }
      if (!stub.files[branch]) return jsonResponse(404, { error: "Not found" });
      const previousPath = String(body?.previousPath ?? "");
      const fields: Record<string, string> = {};
      const pathError = filePathError(String(body?.path ?? ""), stub, branch, previousPath);
      if (pathError) fields.path = pathError;
      const message = String(body?.message ?? "").trim();
      if (!message) fields.message = "Commit message is required";
      else if ([...message].length > 72) fields.message = "The commit message must be 72 characters or fewer";
      if (Object.keys(fields).length > 0) {
        return jsonResponse(400, { error: "File change failed", fields });
      }
      const target = String(body?.path ?? "").trim();
      const files = stub.files[branch];
      if (previousPath && previousPath !== target) delete files[previousPath];
      files[target] = String(body?.content ?? "");
      const commit: StubCommit = {
        id: `commit-${stub.writes.length}`,
        shortId: `c${stub.writes.length}`.padEnd(7, "0"),
        message,
        author: stub.account.username,
        createdAt: "2024-03-02T10:00:00.000Z",
        parentId: stub.branches.find((branchRef) => branchRef.name === branch)?.headCommitId ?? null,
        changedFiles: [target],
      };
      stub.history[branch] = [commit, ...(stub.history[branch] ?? [])];
      const reference = stub.branches.find((branchRef) => branchRef.name === branch);
      if (reference) reference.headCommitId = commit.id;
      return jsonResponse(201, {
        repository: context(stub, branch),
        file: {
          path: target,
          name: target.split("/").pop(),
          branch,
          content: files[target],
          commit: { ...commit, changedFiles: undefined },
        },
        commit: {
          id: commit.id,
          message: commit.message,
          author: commit.author,
          createdAt: commit.createdAt,
          parentId: commit.parentId,
          branch,
        },
      });
    }
    if (fileMatch && method === "GET") {
      const branch = url.searchParams.get("branch") || stub.defaultBranch;
      const wanted = url.searchParams.get("path") ?? "";
      const files = stub.files[branch];
      if (!files || files[wanted] === undefined) {
        return jsonResponse(404, { error: "File not found", repository: context(stub, branch) });
      }
      return jsonResponse(200, {
        repository: context(stub, branch),
        file: {
          path: wanted,
          name: wanted.split("/").pop(),
          branch,
          content: files[wanted],
          commit: (stub.history[branch] ?? [])[0] ?? null,
        },
      });
    }

    const branchesMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/branches$/);
    if (branchesMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!canWrite(stub.role)) {
        return jsonResponse(403, {
          error: "You need write permission to create a branch in this repository.",
        });
      }
      const name = String(body?.name ?? "");
      const error = branchNameError(name, stub);
      if (error) return jsonResponse(400, { error: "Branch creation failed", fields: { name: error } });
      const baseBranch = String(body?.baseBranch ?? stub.defaultBranch);
      const base = stub.branches.find((branch) => branch.name === baseBranch);
      stub.branches = [...stub.branches, { name, headCommitId: base?.headCommitId ?? null }];
      stub.files[name] = { ...(stub.files[baseBranch] ?? {}) };
      stub.history[name] = [...(stub.history[baseBranch] ?? [])];
      return jsonResponse(201, {
        repository: context(stub, name),
        branch: {
          name,
          headCommitId: base?.headCommitId ?? null,
          baseRef: baseBranch,
          baseCommitId: base?.headCommitId ?? null,
          createdBy: stub.account.username,
          createdAt: "2024-03-02T10:00:00.000Z",
        },
      });
    }

    const defaultMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/default-branch$/);
    if (defaultMatch && method === "POST") {
      stub.writes.push({ method, path, body: body ?? {} });
      if (!stub.account) return jsonResponse(401, { error: "Not authenticated" });
      if (!stub.canAdminister) {
        return jsonResponse(403, {
          error: "You must be a repository administrator to change the default branch.",
        });
      }
      const branch = String(body?.branch ?? "");
      if (!stub.branches.some((candidate) => candidate.name === branch)) {
        return jsonResponse(400, { error: "Default branch update failed", fields: { branch: "That branch does not exist." } });
      }
      stub.defaultBranch = branch;
      return jsonResponse(200, { repository: context(stub, branch) });
    }

    const commitsMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/commits$/);
    if (commitsMatch) {
      const branch = url.searchParams.get("branch") || stub.defaultBranch;
      const wanted = url.searchParams.get("path") ?? "";
      const history = stub.history[branch] ?? [];
      return jsonResponse(200, {
        repository: context(stub, branch),
        branch,
        path: wanted,
        files: Object.keys(stub.files[branch] ?? {}),
        commits: wanted ? history.filter((commit) => commit.changedFiles.includes(wanted)) : history,
      });
    }

    const overviewMatch = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)$/);
    if (overviewMatch) {
      const branch = url.searchParams.get("branch") || stub.defaultBranch;
      const files = stub.files[branch];
      if (!files) return jsonResponse(404, { error: "Not found" });
      const directory = url.searchParams.get("path") ?? "";
      if (!directoryExists(files, directory)) {
        return jsonResponse(404, { error: "Directory not found", repository: context(stub, branch) });
      }
      return jsonResponse(200, {
        repository: {
          ...context(stub, branch),
          path: directory,
          entries: entriesFor(files, directory),
          commits: stub.history[branch] ?? [],
        },
      });
    }

    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

function signedInAsAlice(stub: Stub, role: Role = "admin", canAdminister = true) {
  stub.account = ALICE;
  stub.role = role;
  stub.canAdminister = canAdminister;
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listing and switching repository branches (REQ-4-3-1)", () => {
  it("switches to the target branch and shows its only file, then back to main", async () => {
    const stub = initialStub();
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");

    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "main-only.md" })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "feature");

    // Typing filters the options immediately, without Enter or a search button.
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "feature-search" }));

    // The page, the selector and the file list all read the target branch.
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "main-only.md" })).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();

    // Reading the file shows the content of that branch.
    await user.click(screen.getByRole("link", { name: "README.md" }));
    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    await waitFor(() => {
      const code = document.querySelector(".repository-file__content code");
      expect(code?.textContent).toBe(README_FEATURE);
    });

    // The selector lists both branches and marks the current one.
    await user.click(screen.getByRole("button", { name: "Branch feature-search" }));
    const current = await screen.findByRole("option", { name: "feature-search" });
    expect(current.getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("option", { name: "main" }));
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
    await waitFor(() => {
      const code = document.querySelector(".repository-file__content code");
      expect(code?.textContent).toBe(README_MAIN);
    });

    // Switching branches writes nothing: no branch head moved.
    expect(stub.writes).toEqual([]);
    expect(stub.branches.find((branch) => branch.name === "main")?.headCommitId).toBe(
      SEARCH_LOADER.id,
    );
    expect(stub.branches.find((branch) => branch.name === "feature-search")?.headCommitId).toBe(
      SEARCH_LOADER.id,
    );
  });

  it("keeps an unmatched search on the current branch and reports the empty state", async () => {
    const stub = initialStub();
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "no-such-branch");

    expect(screen.getByText("No matching branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();

    // Escape closes the selector and keeps the active branch.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();

    // Reloading the page entry keeps the same branch.
    cleanup();
    open("#/repos/alice-dev/acme-docs");
    expect(await screen.findByRole("button", { name: "Branch main" })).toBeTruthy();
  });
});

describe("creating a branch from the selector (REQ-4-3-2)", () => {
  it("offers the creation option with its base and switches to the new branch", async () => {
    const stub = initialStub();
    signedInAsAlice(stub, "admin", true);
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "feature/api-v2");

    // The base defaults to the current branch head and is displayed.
    expect(screen.getByText(/Base branch: main/)).toBeTruthy();
    expect(screen.queryByText("Invalid branch")).toBeNull();
    const creation = screen.getByRole("option", { name: "Create branch: feature/api-v2" });
    await user.click(creation);

    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();
    expect(stub.writes).toEqual([
      {
        method: "POST",
        path: `${REPO_PATH}/branches`,
        body: { name: "feature/api-v2", baseBranch: "main" },
      },
    ]);
    // The new branch reads the snapshot of its base commit and the base branch
    // keeps its own head.
    const created = stub.branches.find((branch) => branch.name === "feature/api-v2");
    expect(created?.headCommitId).toBe(SEARCH_LOADER.id);
    expect(stub.branches.find((branch) => branch.name === "main")?.headCommitId).toBe(
      SEARCH_LOADER.id,
    );

    // The new branch stays selected after reloading the page entry.
    cleanup();
    open(repositoryTreeHref("alice-dev", "acme-docs", "feature/api-v2"));
    expect(await screen.findByRole("button", { name: "Branch feature/api-v2" })).toBeTruthy();
  });

  it("reports an invalid or existing name without creating a reference", async () => {
    const stub = initialStub();
    signedInAsAlice(stub, "write", false);
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    const find = await screen.findByRole("textbox", { name: "Find branch" });

    await user.type(find, "invalid..branch");
    expect(screen.getByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();

    await user.clear(find);
    await user.type(find, "feature-search");
    expect(screen.queryByRole("option", { name: /Create branch/ })).toBeNull();
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();

    expect(stub.writes).toEqual([]);
    expect(stub.branches.map((branch) => branch.name)).toEqual([
      "main",
      "feature-search",
      "release",
    ]);
  });

  it("reports the server refusal of a signed-in non-writer and creates nothing", async () => {
    const stub = initialStub();
    stub.account = READER;
    stub.role = "read";
    stub.canAdminister = false;
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "reader-branch");
    await user.click(screen.getByRole("option", { name: "Create branch: reader-branch" }));

    expect(
      await screen.findByText("You need write permission to create a branch in this repository."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(stub.branches.map((branch) => branch.name)).toEqual([
      "main",
      "feature-search",
      "release",
    ]);
  });
});

describe("changing the repository default branch (REQ-4-3-3)", () => {
  it("lets an administrator update it from Settings → Branches and persists the change", async () => {
    const stub = initialStub();
    signedInAsAlice(stub, "admin", true);
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("link", { name: "Branches" }));

    expect(await screen.findByRole("heading", { name: "Branches" })).toBeTruthy();
    const select = (await screen.findByRole("combobox", { name: "Default branch" })) as HTMLSelectElement;
    expect([...select.options].map((option) => option.label)).toEqual([
      "main",
      "feature-search",
      "release",
    ]);
    expect(select.value).toBe("main");

    await user.selectOptions(select, "release");
    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(
        (screen.getByRole("combobox", { name: "Default branch" }) as HTMLSelectElement).value,
      ).toBe("release"),
    );
    expect(stub.defaultBranch).toBe("release");
    expect(stub.branches.map((branch) => branch.name)).toEqual([
      "main",
      "feature-search",
      "release",
    ]);

    // The repository entry without a branch now reads the new default while the
    // previous default stays available in the selector.
    cleanup();
    open("#/repos/alice-dev/acme-docs");
    expect(await screen.findByRole("button", { name: "Branch release" })).toBeTruthy();
    const open2 = userEvent.setup();
    await open2.click(screen.getByRole("button", { name: "Branch release" }));
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
  });

  it("renders no default-branch control for a non-administrator", async () => {
    const stub = initialStub();
    stub.account = READER;
    stub.role = "read";
    stub.canAdminister = false;
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs/settings/branches");

    expect(await screen.findByRole("heading", { name: "Branches" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.getByText("main", { selector: ".repository-branch__name" })).toBeTruthy();
    expect(stub.writes).toEqual([]);
  });
});

describe("managing repository files through the web interface (REQ-4-4)", () => {
  it("adds a file from the Code page and opens the saved content and its history", async () => {
    const stub = initialStub();
    signedInAsAlice(stub, "write", false);
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");
    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add file" }));
    await user.click(await screen.findByRole("menuitem", { name: "Create new file" }));

    // The editor offers the three fields and the submission button.
    const name = await screen.findByRole("textbox", { name: "File name" });
    const contents = screen.getByRole("textbox", { name: "File contents" });
    const message = screen.getByRole("textbox", { name: "Commit message" });
    expect((message as HTMLInputElement).value).toBe("");

    await user.type(name, "docs/guide.md");
    await user.type(contents, "# Guide\n\nHow to use the Acme platform.");
    await user.type(message, "Add docs/guide.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    // The saved content is displayed by the file view that opens next.
    expect(await screen.findByRole("heading", { name: "guide.md" })).toBeTruthy();
    expect(document.querySelector(".repository-file__content code")?.textContent).toBe(
      "# Guide\n\nHow to use the Acme platform.",
    );
    expect(stub.files.main["docs/guide.md"]).toBe("# Guide\n\nHow to use the Acme platform.");
    expect(stub.branches.find((branch) => branch.name === "main")?.headCommitId).toBe("commit-1");

    // The history of the file holds the exact submitted message.
    await user.click(screen.getByRole("link", { name: "Commits" }));
    expect(await screen.findByText(/Commits that changed/)).toBeTruthy();
    expect(screen.getAllByText("Add docs/guide.md").length).toBeGreaterThan(0);
  });

  it("reports an invalid path and a missing commit message and stores nothing", async () => {
    const stub = initialStub();
    signedInAsAlice(stub, "write", false);
    installFetch(stub);
    open(repositoryEditorHref("alice-dev", "acme-docs", "main"));
    await screen.findByRole("heading", { name: "Create new file" });

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "File name" }), "../invalid.md");
    await user.type(screen.getByRole("textbox", { name: "File contents" }), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(screen.getByText("Commit message is required")).toBeTruthy();
    expect(stub.files.main["../invalid.md"]).toBeUndefined();
    expect(stub.branches.find((branch) => branch.name === "main")?.headCommitId).toBe(
      SEARCH_LOADER.id,
    );
    expect(screen.getByRole("heading", { name: "Create new file" })).toBeTruthy();
  });

  it("edits an existing file from the file page", async () => {
    const stub = initialStub();
    signedInAsAlice(stub, "maintain", false);
    installFetch(stub);
    open(repositoryBlobHref("alice-dev", "acme-docs", "main", DOCS_PATH));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Edit" }));

    const contents = (await screen.findByRole("textbox", { name: "File contents" })) as HTMLTextAreaElement;
    expect(contents.value).toBe(DOCS_README);
    await user.clear(contents);
    await user.type(contents, "# Getting started\n\nRun the setup command twice.\n");
    await user.type(screen.getByRole("textbox", { name: "Commit message" }), "Clarify the setup");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByRole("heading", { name: "README.md" })).toBeTruthy();
    expect(stub.files.main[DOCS_PATH]).toBe("# Getting started\n\nRun the setup command twice.\n");
    expect(stub.history.main[0].changedFiles).toEqual([DOCS_PATH]);
  });

  it("offers no Add file entry to a visitor and refuses the editor", async () => {
    const stub = initialStub();
    installFetch(stub);
    open("#/repos/alice-dev/acme-docs");

    await screen.findByRole("heading", { name: "alice-dev/acme-docs" });
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
    expect(stub.writes).toEqual([]);

    cleanup();
    open(repositoryEditorHref("alice-dev", "acme-docs", "main"));
    expect(
      await screen.findByText("You need write permission to edit files in this repository."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Commit changes" })).toBeNull();
  });
});
