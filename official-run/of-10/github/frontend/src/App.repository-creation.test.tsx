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

const BOB: AccountFixture = {
  id: "account-bob-reviewer",
  username: "bob-reviewer",
  email: "bob.reviewer@example.test",
  emailVerified: true,
};

interface FakeRepository {
  id: string;
  owner: string;
  name: string;
  visibility: "public" | "private";
  description: string;
  defaultBranch: string;
  updatedAt: string;
  forkedFrom: { id: string; owner: string; name: string } | null;
  files: Array<{ path: string; content: string }>;
}

function fakeRepository(partial: Omit<FakeRepository, "defaultBranch" | "updatedAt" | "files"> & {
  files?: Array<{ path: string; content: string }>;
}): FakeRepository {
  return {
    defaultBranch: "main",
    updatedAt: "2024-02-12T09:30:00.000Z",
    files: [{ path: "README.md", content: `# ${partial.name}\n` }],
    ...partial,
  };
}

const ACME_DOCS = fakeRepository({
  id: "repo-alice-dev-acme-docs",
  owner: "alice-dev",
  name: "acme-docs",
  visibility: "public",
  description: "Documentation and guides for the Acme platform.",
  forkedFrom: null,
});

const SECRET_RESEARCH = fakeRepository({
  id: "repo-alice-dev-secret-research",
  owner: "alice-dev",
  name: "secret-research",
  visibility: "private",
  description: "Confidential research notes for the Acme platform.",
  forkedFrom: null,
});

const ACME_DOCS_FORK = fakeRepository({
  id: "repo-alice-dev-acme-docs-fork",
  owner: "alice-dev",
  name: "acme-docs-fork",
  visibility: "private",
  description: ACME_DOCS.description,
  forkedFrom: { id: ACME_DOCS.id, owner: "alice-dev", name: "acme-docs" },
});

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

interface FakeWorld {
  session: AccountFixture | null;
  repositories: FakeRepository[];
  /** Direct repository roles: Write for bob, so he is a non-Admin collaborator. */
  grants: Array<{ repositoryId: string; accountId: string; role: string }>;
}

function roleFor(world: FakeWorld, repository: FakeRepository): string | null {
  const session = world.session;
  if (!session) return null;
  if (repository.owner === session.username) return "admin";
  return (
    world.grants.find(
      (grant) => grant.repositoryId === repository.id && grant.accountId === session.id,
    )?.role ?? null
  );
}

function readable(world: FakeWorld, repository: FakeRepository): boolean {
  return repository.visibility === "public" || roleFor(world, repository) !== null;
}

function summary(world: FakeWorld, repository: FakeRepository) {
  const role = roleFor(world, repository);
  return {
    id: repository.id,
    name: repository.name,
    fullName: `${repository.owner}/${repository.name}`,
    owner: { type: "user", login: repository.owner },
    visibility: repository.visibility,
    description: repository.description,
    defaultBranch: repository.defaultBranch,
    updatedAt: repository.updatedAt,
    forkedFrom: repository.forkedFrom
      ? {
          id: repository.forkedFrom.id,
          owner: repository.forkedFrom.owner,
          name: repository.forkedFrom.name,
          fullName: `${repository.forkedFrom.owner}/${repository.forkedFrom.name}`,
        }
      : null,
    permissions: { role, canAdminister: role === "admin" },
  };
}

function overview(world: FakeWorld, repository: FakeRepository) {
  return {
    ...summary(world, repository),
    branch: repository.defaultBranch,
    entries: repository.files.map((file) => ({
      type: "file",
      name: file.path.split("/").pop(),
      path: file.path,
    })),
    commits: [
      {
        id: `${repository.id}-commit-1`,
        message: "Initial commit",
        author: repository.owner,
        createdAt: repository.updatedAt,
      },
    ],
  };
}

/** Minimal in-memory stand-in for the repository HTTP API. */
function installFetch(world: FakeWorld) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (path === "/api/session") return jsonResponse(200, { account: world.session });
    if (path === "/api/sessions" && method === "POST") return jsonResponse(200, { account: world.session });

    if (path === "/api/namespaces") {
      const session = world.session;
      if (!session) return jsonResponse(401, { error: "Not authenticated" });
      return jsonResponse(200, { namespaces: [{ type: "user", login: session.username }] });
    }

    if (path === "/api/repositories" && method === "GET") {
      const login = (url.searchParams.get("owner") ?? "").toLowerCase();
      if (!["alice-dev", "bob-reviewer"].includes(login)) {
        return jsonResponse(404, { error: "Not found" });
      }
      return jsonResponse(200, {
        owner: { type: "user", login },
        repositories: world.repositories
          .filter((repository) => repository.owner === login && readable(world, repository))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((repository) => summary(world, repository)),
      });
    }

    if (path === "/api/repositories" && method === "POST") {
      if (!world.session) return jsonResponse(401, { error: "Not authenticated" });
      const name = String(body.name ?? "").trim();
      if (!name) {
        return jsonResponse(400, {
          error: "Repository creation failed",
          fields: { name: "Repository name is required" },
        });
      }
      if (world.repositories.some((repository) => repository.owner === body.owner && repository.name === name)) {
        return jsonResponse(400, {
          error: "Repository creation failed",
          fields: { name: `The repository ${body.owner}/${name} already exists on this account.` },
        });
      }
      const created = fakeRepository({
        id: `repo-${body.owner}-${name}`,
        owner: body.owner,
        name,
        visibility: body.visibility === "private" ? "private" : "public",
        description: String(body.description ?? ""),
        forkedFrom: null,
        files: body.initializeWithReadme
          ? [{ path: "README.md", content: `# ${name}\n\n${body.description ?? ""}\n` }]
          : [],
      });
      world.repositories.push(created);
      return jsonResponse(201, { repository: overview(world, created) });
    }

    const forkDefaults = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/forks$/);
    if (forkDefaults && method === "GET") {
      const [, owner, name] = forkDefaults.map(decodeURIComponent);
      const source = world.repositories.find(
        (repository) => repository.owner === owner && repository.name === name,
      );
      if (!source || !readable(world, source) || !world.session) {
        return jsonResponse(404, { error: "Not found" });
      }
      const namespace = url.searchParams.get("namespace") ?? world.session.username;
      let suggested = source.name;
      let index = 1;
      while (
        world.repositories.some(
          (repository) => repository.owner === namespace && repository.name === suggested,
        )
      ) {
        suggested = `${source.name}-${index}`;
        index += 1;
      }
      return jsonResponse(200, {
        namespace: { type: "user", login: namespace },
        name: suggested,
        visibility: source.visibility,
      });
    }

    if (forkDefaults && method === "POST") {
      if (!world.session) return jsonResponse(401, { error: "Not authenticated" });
      const [, owner, name] = forkDefaults.map(decodeURIComponent);
      const source = world.repositories.find(
        (repository) => repository.owner === owner && repository.name === name,
      );
      if (!source) return jsonResponse(404, { error: "Not found" });
      const forkName = String(body.name ?? "").trim() || `${source.name}-1`;
      if (
        world.repositories.some(
          (repository) => repository.owner === body.owner && repository.name === forkName,
        )
      ) {
        return jsonResponse(400, {
          error: "Fork creation failed",
          fields: {
            name: `The repository ${body.owner}/${forkName} already exists on this account.`,
          },
        });
      }
      const fork = fakeRepository({
        id: `repo-${body.owner}-${forkName}`,
        owner: body.owner,
        name: forkName,
        visibility: source.visibility === "private" ? "private" : "public",
        description: source.description,
        forkedFrom: { id: source.id, owner: source.owner, name: source.name },
        files: source.files,
      });
      world.repositories.push(fork);
      return jsonResponse(201, { repository: overview(world, fork) });
    }

    const visibilityRoute = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/visibility$/);
    if (visibilityRoute && method === "POST") {
      if (!world.session) return jsonResponse(401, { error: "Not authenticated" });
      const [, owner, name] = visibilityRoute.map(decodeURIComponent);
      const repository = world.repositories.find(
        (candidate) => candidate.owner === owner && candidate.name === name,
      );
      if (!repository || !readable(world, repository)) {
        return jsonResponse(404, { error: "Not found" });
      }
      if (roleFor(world, repository) !== "admin") {
        return jsonResponse(403, {
          error: "You must be a repository administrator to change its visibility.",
        });
      }
      const confirmation = String(body.confirmationName ?? "").trim().toLowerCase();
      const accepted = [name.toLowerCase(), `${owner}/${name}`.toLowerCase()];
      if (confirmation && !accepted.includes(confirmation)) {
        return jsonResponse(400, {
          error: "Repository name does not match",
          fields: { confirmationName: "The repository name does not match" },
        });
      }
      repository.visibility = body.visibility === "private" ? "private" : "public";
      return jsonResponse(200, { repository: overview(world, repository) });
    }

    const fileRoute = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)\/file$/);
    if (fileRoute) {
      const [, owner, name] = fileRoute.map(decodeURIComponent);
      const repository = world.repositories.find(
        (candidate) => candidate.owner === owner && candidate.name === name,
      );
      if (!repository || !readable(world, repository)) return jsonResponse(404, { error: "Not found" });
      const wanted = url.searchParams.get("path") ?? "";
      const file = repository.files.find((candidate) => candidate.path === wanted);
      if (!file) return jsonResponse(404, { error: "Not found" });
      return jsonResponse(200, {
        repository: summary(world, repository),
        file: {
          path: file.path,
          name: file.path.split("/").pop(),
          branch: repository.defaultBranch,
          content: file.content,
          commit: null,
        },
      });
    }

    const overviewRoute = path.match(/^\/api\/repositories\/([^/]+)\/([^/]+)$/);
    if (overviewRoute) {
      const [, owner, name] = overviewRoute.map(decodeURIComponent);
      const repository = world.repositories.find(
        (candidate) => candidate.owner === owner && candidate.name === name,
      );
      if (!repository || !readable(world, repository)) {
        return jsonResponse(404, { error: "Not found" });
      }
      return jsonResponse(200, { repository: overview(world, repository) });
    }

    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function newWorld(account: AccountFixture | null = null): FakeWorld {
  return {
    session: account,
    // Each test gets its own copy so a visibility or creation change never leaks.
    repositories: structuredClone([ACME_DOCS, SECRET_RESEARCH, ACME_DOCS_FORK]),
    grants: [{ repositoryId: SECRET_RESEARCH.id, accountId: BOB.id, role: "write" }],
  };
}

function open(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

/** Visible visibility marker of the repository chrome. */
function visibilityMarker(): string {
  return document.querySelector(".visibility-badge")?.textContent?.trim() ?? "";
}

function reload() {
  const hash = window.location.hash;
  cleanup();
  window.location.hash = hash;
  render(<App />);
}

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("repository creation (REQ-3-2-1)", () => {
  it("creates a private repository with a README from the workspace entry", async () => {
    const world = newWorld(ALICE);
    installFetch(world);
    open("#/workspace");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "New repository" }));

    expect(await screen.findByRole("heading", { name: "New repository", level: 1 })).toBeTruthy();
    const ownerSelect = screen.getByLabelText("Owner") as HTMLSelectElement;
    expect(ownerSelect.value).toBe("alice-dev");
    expect(screen.getByLabelText("Repository name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Private" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Add a README file" }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Create repository" })).toBeTruthy();

    await user.type(screen.getByLabelText("Repository name"), "pw-notes");
    await user.type(screen.getByLabelText("Description"), "Repository created by Playwright");
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("checkbox", { name: "Add a README file" }));
    await user.click(screen.getByRole("button", { name: "Create repository" }));

    const heading = await screen.findByRole("heading", { name: "alice-dev/pw-notes", level: 1 });
    expect(heading).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Repository created by Playwright")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    const commits = screen.getByRole("region", { name: "Commit history" });
    expect(within(commits).getByText("Initial commit")).toBeTruthy();

    reload();
    expect(await screen.findByRole("heading", { name: "alice-dev/pw-notes", level: 1 })).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();
    expect(screen.getByText("Repository created by Playwright")).toBeTruthy();
  });

  it("keeps the form for an empty or duplicated name", async () => {
    const world = newWorld(ALICE);
    installFetch(world);
    open("#/workspace");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "New repository" }));
    await screen.findByRole("heading", { name: "New repository", level: 1 });

    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByText("Repository name is required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New repository", level: 1 })).toBeTruthy();
    expect(world.repositories).toHaveLength(3);

    await user.type(screen.getByLabelText("Repository name"), "acme-docs");
    await user.click(screen.getByRole("button", { name: "Create repository" }));
    expect(await screen.findByText(/already exists on this account/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New repository", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "alice-dev/acme-docs", level: 1 })).toBeNull();
    expect(world.repositories).toHaveLength(3);
  });
});

describe("forking a repository (REQ-3-2-2)", () => {
  it("opens the new fork with its source link and keeps it across a reload", async () => {
    const world = newWorld(ALICE);
    installFetch(world);
    open("#/repos/alice-dev/acme-docs");
    await screen.findByRole("heading", { name: "alice-dev/acme-docs", level: 1 });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fork" }));

    const dialog = await screen.findByRole("dialog", { name: "Create a new fork" });
    const nameField = within(dialog).getByLabelText("Repository name") as HTMLInputElement;
    await waitFor(() => expect(nameField.value).toBe("acme-docs-1"));
    expect((within(dialog).getByLabelText("Owner") as HTMLSelectElement).value).toBe("alice-dev");
    expect((within(dialog).getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs-1", level: 1 })).toBeTruthy();
    const sourceLink = screen.getByRole("link", { name: "alice-dev/acme-docs" });
    expect(sourceLink.getAttribute("href")).toBe("#/repos/alice-dev/acme-docs");
    expect(screen.getByText(/Forked from/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "README.md" })).toBeTruthy();

    reload();
    expect(await screen.findByRole("heading", { name: "alice-dev/acme-docs-1", level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "alice-dev/acme-docs" })).toBeTruthy();
  });

  it("rejects a fork name that already exists in the target namespace", async () => {
    const world = newWorld(ALICE);
    installFetch(world);
    open("#/repos/alice-dev/acme-docs");
    await screen.findByRole("heading", { name: "alice-dev/acme-docs", level: 1 });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fork" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a new fork" });
    const nameField = within(dialog).getByLabelText("Repository name");
    await user.clear(nameField);
    await user.type(nameField, "acme-docs-fork");
    await user.click(within(dialog).getByRole("button", { name: "Create fork" }));

    expect(await within(dialog).findByText(/already exists on this account/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Create a new fork" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "alice-dev/acme-docs-fork", level: 1 })).toBeNull();
    expect(world.repositories).toHaveLength(3);
  });
});

describe("clone values (REQ-3-2-3)", () => {
  it("shows and copies the HTTPS and SSH values and keeps the heading", async () => {
    const clipboard: string[] = [];
    installFetch(newWorld(null));
    open("#/repos/alice-dev/acme-docs");
    await screen.findByRole("heading", { name: "alice-dev/acme-docs", level: 1 });

    const user = userEvent.setup();
    // The app writes through navigator.clipboard; record what it stores.
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => clipboard.push(value) },
    });
    // The navigation link and the popover button share the name "Code".
    expect(screen.getByRole("link", { name: "Code" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Code" }));

    const httpsTab = screen.getByRole("tab", { name: "HTTPS" });
    expect(httpsTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/^https:\/\/.+\/alice-dev\/acme-docs\.git$/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Copy clone value" }));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(clipboard.at(-1)).toMatch(/^https:\/\/.+\/alice-dev\/acme-docs\.git$/);
    expect(screen.getByRole("heading", { name: "alice-dev/acme-docs", level: 1 })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "SSH" }));
    expect(screen.getByText(/^git@[^:]+:alice-dev\/acme-docs\.git$/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy clone value" }));
    expect(clipboard.at(-1)).toMatch(/^git@[^:]+:alice-dev\/acme-docs\.git$/);

    // Closing and reopening the popover keeps the selected protocol.
    await user.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.queryByRole("tab", { name: "SSH" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("tab", { name: "SSH" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("repository visibility (REQ-3-4)", () => {
  it("changes a private repository to Public from Settings → General", async () => {
    const world = newWorld(ALICE);
    installFetch(world);
    open("#/repos/alice-dev/secret-research/settings");
    await screen.findByRole("heading", { name: "alice-dev/secret-research", level: 1 });
    expect(screen.getByText("Private")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "General" }));
    expect(await screen.findByRole("heading", { name: "General", level: 2 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change repository visibility" });
    expect((within(dialog).getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Public")).toBeTruthy();
    expect(screen.getByText("Visibility updated.")).toBeTruthy();

    reload();
    expect(await screen.findByText("Public")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change visibility" })).toBeTruthy();

    // The visitor now reaches the repository through its address.
    world.session = null;
    reload();
    expect(await screen.findByRole("heading", { name: "alice-dev/secret-research", level: 1 })).toBeTruthy();
    expect(screen.getByText("Public")).toBeTruthy();
  });

  it("keeps the visibility when the confirmation text does not match", async () => {
    const world = newWorld(ALICE);
    installFetch(world);
    open("#/repos/alice-dev/secret-research/settings/general");
    await screen.findByRole("heading", { name: "Danger Zone" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Change repository visibility" });
    await user.type(within(dialog).getByLabelText("Repository name"), "wrong-name");
    await user.click(within(dialog).getByRole("button", { name: "Confirm visibility" }));

    expect(await within(dialog).findByText("The repository name does not match")).toBeTruthy();
    expect(visibilityMarker()).toBe("Private");
    expect(world.repositories.find((repository) => repository.name === "secret-research")?.visibility).toBe(
      "private",
    );
  });

  it("hides the visibility action from a non-Admin collaborator", async () => {
    installFetch(newWorld(BOB));
    open("#/repos/alice-dev/secret-research/settings/general");
    await screen.findByRole("heading", { name: "alice-dev/secret-research", level: 1 });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "General" }));
    expect(await screen.findByRole("heading", { name: "General", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change visibility" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Danger Zone" })).toBeNull();
    // The collaborator still reads the private repository content.
    expect(screen.getByText("Private")).toBeTruthy();
  });
});
