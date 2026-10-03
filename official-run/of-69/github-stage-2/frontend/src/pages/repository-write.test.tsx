import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import * as organizationApi from "../lib/organization-api";
import type { RepositoryRole } from "../lib/organization-api";
import * as sessionApi from "../lib/session-api";
import { SessionProvider } from "../session/session-context";
import { RepositoryBranchesSettingsPage } from "./RepositoryBranchesSettingsPage";
import { RepositoryNewFilePage } from "./RepositoryNewFilePage";
import { RepositoryOverviewPage } from "./RepositoryOverviewPage";
import { RepositorySettingsPage } from "./RepositorySettingsPage";

vi.mock("../lib/session-api", () => ({
  fetchSession: vi.fn().mockResolvedValue(null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  registerAccount: vi.fn(),
  startRecovery: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("../lib/organization-api", () => ({
  fetchPublicOrganizations: vi.fn(),
  fetchMyOrganizations: vi.fn(),
  fetchReadableRepositories: vi.fn(),
  searchRepositories: vi.fn(),
  createOrganization: vi.fn(),
  fetchOrganization: vi.fn(),
  fetchOrganizationRepositories: vi.fn(),
  fetchRepository: vi.fn(),
  fetchUserRepository: vi.fn(),
  createRepository: vi.fn(),
  createFork: vi.fn(),
  createBranch: vi.fn(),
  createFile: vi.fn(),
  updateDefaultBranch: vi.fn(),
  updateRepositoryVisibility: vi.fn(),
  fetchRepositoryCommits: vi.fn(),
  fetchCommitDetail: vi.fn(),
  searchRepositoryCode: vi.fn(),
  fetchOrganizationMembers: vi.fn(),
  fetchOrganizationTeams: vi.fn(),
  createTeam: vi.fn(),
  fetchTeam: vi.fn(),
  saveTeamParent: vi.fn(),
  fetchTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  addOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
  fetchRepositoryAccess: vi.fn(),
  addRepositoryTeamGrant: vi.fn(),
  updateRepositoryGrant: vi.fn(),
}));

const CONTRIBUTOR = {
  id: "account-branch-contributor",
  username: "branch-contributor",
  email: "branch-contributor@example.test",
  emailVerified: true,
  status: "available",
};

const DEMO_LABS = { name: "demo-labs", displayName: "Demo Labs" };

const README = {
  path: "README.md",
  content: "# branch-switch-demo\n\nDemonstrates listing and switching repository branches\n",
};

/** The seeded `branch-switch-demo`: `main` and the target branch `feature-search`. */
function branchDetail(params: { branch?: string | null; repositoryRole?: string | null; extraBranches?: string[] } = {}) {
  const branch = params.branch ?? "main";
  const branches = ["feature-search", "main", ...(params.extraBranches ?? [])];
  const onTarget = branch === "feature-search";
  return {
    organization: DEMO_LABS,
    viewer: {
      role: null,
      repositoryRole: (params.repositoryRole ?? null) as RepositoryRole | null,
      canManage: params.repositoryRole === "admin",
    },
    repository: {
      name: "branch-switch-demo",
      description: "Public repository used to demonstrate listing and switching branches",
      visibility: "public" as const,
      defaultBranch: "main",
      updatedAt: "2024-04-02T10:00:00.000Z",
      forkedFrom: null,
    },
    branch,
    branches: branches.map((name) => ({ name })),
    files: onTarget
      ? [{ path: "main-only.md", content: "Only available on the feature-search branch.\n" }, README]
      : [README],
    readme: README,
    commits: [],
  };
}

/** The seeded `file-management-demo` with an optional already saved file. */
function fileDetail(options: { repositoryRole?: string | null; extraFile?: { path: string; content: string } } = {}) {
  const files = [README, ...(options.extraFile ? [options.extraFile] : [])];
  return {
    organization: DEMO_LABS,
    viewer: {
      role: null,
      repositoryRole: (options.repositoryRole ?? null) as RepositoryRole | null,
      canManage: options.repositoryRole === "admin",
    },
    repository: {
      name: "file-management-demo",
      description: "Public repository used to demonstrate adding a file through the web interface",
      visibility: "public" as const,
      defaultBranch: "main",
      updatedAt: "2024-04-04T10:00:00.000Z",
      forkedFrom: null,
    },
    branch: "main",
    branches: [{ name: "main" }],
    files,
    readme: README,
    commits: [],
  };
}

/** The seeded `default-branch-demo` with its `main` and `release` branches. */
function defaultBranchDetail(repositoryRole: string | null) {
  return {
    organization: DEMO_LABS,
    viewer: { role: null, repositoryRole: repositoryRole as RepositoryRole | null, canManage: repositoryRole === "admin" },
    repository: {
      name: "default-branch-demo",
      description: "Public repository used to demonstrate changing the default branch",
      visibility: "public" as const,
      defaultBranch: "main",
      updatedAt: "2024-04-03T10:00:00.000Z",
      forkedFrom: null,
    },
    branch: "main",
    branches: [{ name: "main" }, { name: "release" }],
    files: [README],
    readme: README,
    commits: [],
  };
}

function renderPage(node: ReactNode) {
  return render(<SessionProvider>{node}</SessionProvider>);
}

function signInAs(account: typeof CONTRIBUTOR) {
  vi.mocked(sessionApi.fetchSession).mockResolvedValue(account);
}

beforeEach(() => {
  window.location.hash = "#/";
  vi.clearAllMocks();
  vi.mocked(sessionApi.fetchSession).mockResolvedValue(null);
});

afterEach(cleanup);

describe("REQ-4-3-1 list and switch repository branches", () => {
  it("lists options, filters as the user types and switches the browsing snapshot", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/branch-switch-demo";
    vi.mocked(organizationApi.fetchRepository).mockImplementation(async (_org, _repo, params) =>
      branchDetail({ branch: params?.branch ?? "main" }),
    );

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="branch-switch-demo" />);

    // The selector is one button named after the current branch.
    const toggle = await screen.findByRole("button", { name: "Branch main" });
    expect(toggle).toBeTruthy();
    await user.click(toggle);

    // It opens the “Find branch” textbox and the branch options.
    const find = await screen.findByRole("textbox", { name: "Find branch" });
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();

    // Typing filters without Enter or a separate search action.
    await user.type(find, "feature");
    expect(screen.getByRole("option", { name: "feature-search" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "main" })).toBeNull();

    // Selecting the option switches the branch and exposes the target-only file.
    await user.click(screen.getByRole("option", { name: "feature-search" }));
    await waitFor(() => expect(window.location.hash).toContain("branch=feature-search"));
    expect(await screen.findByRole("button", { name: "Branch feature-search" })).toBeTruthy();
    const targetOnly = await screen.findByRole("link", { name: "main-only.md" });
    expect(targetOnly.getAttribute("href")).toContain("branch=feature-search");
  });

  it("keeps the active branch on an unmatched query and after Escape", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/branch-switch-demo";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(branchDetail());

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="branch-switch-demo" />);
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "missing-branch");

    expect(await screen.findByText("No matching branch")).toBeTruthy();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Find branch" })).toBeNull());
    // The active branch is unchanged, and so is the address a reload restores.
    expect(screen.getByRole("button", { name: "Branch main" })).toBeTruthy();
    expect(window.location.hash).toBe("#/organizations/demo-labs/repositories/branch-switch-demo");
  });
});

describe("REQ-4-3-2 create a branch from an existing revision", () => {
  it("offers “Create branch: <name>” to a writer and switches to the new branch", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/branch-switch-demo";
    vi.mocked(organizationApi.fetchRepository).mockImplementation(async (_org, _repo, params) =>
      branchDetail({
        branch: params?.branch ?? "main",
        repositoryRole: "write",
        extraBranches: params?.branch === "pw-branch-abc" ? ["pw-branch-abc"] : [],
      }),
    );
    vi.mocked(organizationApi.createBranch).mockResolvedValue({
      owner: { name: "demo-labs", displayName: "Demo Labs", type: "organization" },
      viewer: { role: null, repositoryRole: "write", canManage: false },
      repository: branchDetail().repository,
      branch: "pw-branch-abc",
      branches: [{ name: "main" }, { name: "pw-branch-abc" }],
      files: [README],
    });
    signInAs(CONTRIBUTOR);

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="branch-switch-demo" />);
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "pw-branch-abc");

    await user.click(await screen.findByRole("option", { name: "Create branch: pw-branch-abc" }));
    expect(organizationApi.createBranch).toHaveBeenCalledWith("demo-labs", "branch-switch-demo", {
      name: "pw-branch-abc",
      base: "main",
    });

    // The selector switches to the generated branch and a reload keeps it.
    await waitFor(() => expect(window.location.hash).toContain("branch=pw-branch-abc"));
    expect(await screen.findByRole("button", { name: "Branch pw-branch-abc" })).toBeTruthy();

    cleanup();
    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="branch-switch-demo" />);
    expect(await screen.findByRole("button", { name: "Branch pw-branch-abc" })).toBeTruthy();
  });

  it("reports an invalid name and never offers the create option", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/branch-switch-demo";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(branchDetail({ repositoryRole: "write" }));
    signInAs(CONTRIBUTOR);

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="branch-switch-demo" />);
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "invalid..branch");

    expect(await screen.findByText("Invalid branch")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Create branch: invalid..branch" })).toBeNull();
    expect(organizationApi.createBranch).not.toHaveBeenCalled();
  });

  it("does not offer branch creation to a reader without write permission", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/branch-switch-demo";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(branchDetail({ repositoryRole: "read" }));
    signInAs(CONTRIBUTOR);

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="branch-switch-demo" />);
    await user.click(await screen.findByRole("button", { name: "Branch main" }));
    await user.type(await screen.findByRole("textbox", { name: "Find branch" }), "pw-branch-denied");

    expect(screen.queryByRole("option", { name: "Create branch: pw-branch-denied" })).toBeNull();
  });
});

describe("REQ-4-3-3 change the repository default branch", () => {
  it("links Settings → Branches and saves the selected branch through the confirmation flow", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/default-branch-demo/settings";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(defaultBranchDetail("admin"));
    vi.mocked(organizationApi.updateDefaultBranch).mockResolvedValue({
      owner: { name: "demo-labs", displayName: "Demo Labs", type: "organization" },
      viewer: { role: null, repositoryRole: "admin", canManage: true },
      repository: defaultBranchDetail("admin").repository,
      branch: "release",
      branches: [{ name: "main" }, { name: "release" }],
    });
    signInAs({ ...CONTRIBUTOR, id: "account-default-branch-admin", username: "default-branch-admin" });

    renderPage(<RepositorySettingsPage organization="demo-labs" repository="default-branch-demo" />);
    const branchesLink = await screen.findByRole("link", { name: "Branches" });
    expect(branchesLink.getAttribute("href")).toBe(
      "#/organizations/demo-labs/repositories/default-branch-demo/settings/branches",
    );

    cleanup();
    renderPage(<RepositoryBranchesSettingsPage organization="demo-labs" repository="default-branch-demo" />);
    const select = await screen.findByRole("combobox", { name: "Default branch" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "main",
      "release",
    ]);

    await user.selectOptions(select, "release");
    expect((select as HTMLSelectElement).value).toBe("release");
    await user.click(screen.getByRole("button", { name: "Update" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(organizationApi.updateDefaultBranch).toHaveBeenCalledWith("demo-labs", "default-branch-demo", "release");
  });

  it("gives a non-admin reader neither the combobox nor an update button", async () => {
    window.location.hash = "#/organizations/demo-labs/repositories/default-branch-demo/settings/branches";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(defaultBranchDetail("read"));
    signInAs({ ...CONTRIBUTOR, id: "account-default-branch-viewer", username: "default-branch-viewer" });

    renderPage(<RepositoryBranchesSettingsPage organization="demo-labs" repository="default-branch-demo" />);
    await screen.findByRole("heading", { name: "Settings" });

    expect(screen.queryByRole("combobox", { name: "Default branch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update default branch" })).toBeNull();
    expect(screen.getByRole("main").textContent ?? "").not.toMatch(/default branch/i);
  });
});

describe("REQ-4-4 manage repository files through the web interface", () => {
  it("offers “Add file” → “Create new file” to a writer and opens the editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/file-management-demo";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(fileDetail({ repositoryRole: "write" }));
    signInAs({ ...CONTRIBUTOR, id: "account-file-contributor", username: "file-contributor" });

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="file-management-demo" />);
    const addFile = await screen.findByRole("button", { name: "Add file" });
    await user.click(addFile);

    await user.click(await screen.findByRole("button", { name: "Create new file" }));
    expect(window.location.hash).toBe("#/organizations/demo-labs/repositories/file-management-demo/new");
  });

  it("keeps the Add file entry away from a reader who may only browse", async () => {
    window.location.hash = "#/organizations/demo-labs/repositories/file-management-demo";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(fileDetail({ repositoryRole: "read" }));
    signInAs(CONTRIBUTOR);

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="file-management-demo" />);
    await screen.findByRole("button", { name: "Branch main" });
    expect(screen.queryByRole("button", { name: "Add file" })).toBeNull();
  });

  it("shows the editor controls and commits a valid file", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/file-management-demo/new";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(fileDetail({ repositoryRole: "write" }));
    vi.mocked(organizationApi.createFile).mockResolvedValue({
      owner: { name: "demo-labs", displayName: "Demo Labs", type: "organization" },
      viewer: { role: null, repositoryRole: "write", canManage: false },
      repository: fileDetail().repository,
      branch: "main",
      path: "pw-file-abc.md",
      content: "Saved through the web editor\n",
      commit: {
        id: "commit-new",
        message: "Add pw-file-abc.md",
        author: "file-contributor",
        createdAt: "2024-04-05T09:00:00.000Z",
        parentId: "commit-file-management-demo-1",
        changedFiles: ["pw-file-abc.md"],
      },
    });
    signInAs({ ...CONTRIBUTOR, id: "account-file-contributor", username: "file-contributor" });

    renderPage(<RepositoryNewFilePage ownerType="organization" owner="demo-labs" repository="file-management-demo" />);

    expect(await screen.findByRole("textbox", { name: "File name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "File contents" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Commit message" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "File name" }), "pw-file-abc.md");
    await user.type(screen.getByRole("textbox", { name: "File contents" }), "Saved through the web editor\n");
    await user.type(screen.getByRole("textbox", { name: "Commit message" }), "Add pw-file-abc.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(organizationApi.createFile).toHaveBeenCalledWith("demo-labs", "file-management-demo", {
      path: "pw-file-abc.md",
      content: "Saved through the web editor\n",
      message: "Add pw-file-abc.md",
      branch: "main",
    });
    await waitFor(() => expect(window.location.hash).toContain("file=pw-file-abc.md"));
  });

  it("reports an invalid path and a missing message without submitting", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/file-management-demo/new";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(fileDetail({ repositoryRole: "write" }));
    signInAs({ ...CONTRIBUTOR, id: "account-file-contributor", username: "file-contributor" });

    renderPage(<RepositoryNewFilePage ownerType="organization" owner="demo-labs" repository="file-management-demo" />);
    await user.type(await screen.findByRole("textbox", { name: "File name" }), "../invalid.md");
    await user.type(screen.getByRole("textbox", { name: "File contents" }), "must not be saved");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(screen.getByText("Commit message is required")).toBeTruthy();
    expect(organizationApi.createFile).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/organizations/demo-labs/repositories/file-management-demo/new");
  });

  it("displays a saved file and its history link on the file view", async () => {
    window.location.hash =
      "#/organizations/demo-labs/repositories/file-management-demo?file=pw-file-abc.md";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(
      fileDetail({ repositoryRole: "write", extraFile: { path: "pw-file-abc.md", content: "Saved through the web editor\n" } }),
    );
    vi.mocked(organizationApi.fetchRepositoryCommits).mockResolvedValue({
      owner: { name: "demo-labs", displayName: "Demo Labs", type: "organization" },
      viewer: { role: null, repositoryRole: "write", canManage: false },
      repository: fileDetail().repository,
      branch: "main",
      path: null,
      commits: [
        {
          id: "commit-new",
          message: "Add pw-file-abc.md",
          author: "file-contributor",
          createdAt: "2024-04-05T09:00:00.000Z",
          parentId: "commit-file-management-demo-1",
          changedFiles: ["pw-file-abc.md"],
        },
      ],
    });

    renderPage(<RepositoryOverviewPage organization="demo-labs" repository="file-management-demo" />);

    await waitFor(() =>
      expect(document.querySelector(".repository-file__content")?.textContent).toBe("Saved through the web editor\n"),
    );
    // The history link stays the single “Commits” entry of the page.
    expect(screen.getByRole("link", { name: "Commits" }).getAttribute("href")).toBe(
      "#/organizations/demo-labs/repositories/file-management-demo/commits",
    );
  });

  it("surfaces the server field messages when the submission is refused there", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/organizations/demo-labs/repositories/file-management-demo/new";
    vi.mocked(organizationApi.fetchRepository).mockResolvedValue(fileDetail({ repositoryRole: "write" }));
    vi.mocked(organizationApi.createFile).mockRejectedValue(
      new ApiError("Invalid file path", 422, { errors: { path: "Invalid file path" } }),
    );
    signInAs({ ...CONTRIBUTOR, id: "account-file-contributor", username: "file-contributor" });

    renderPage(<RepositoryNewFilePage ownerType="organization" owner="demo-labs" repository="file-management-demo" />);
    // The path and message pass the local rules, so only the server refuses them.
    await user.type(await screen.findByRole("textbox", { name: "File name" }), "pw-file-server.md");
    await user.type(screen.getByRole("textbox", { name: "Commit message" }), "Add pw-file-server.md");
    await user.click(screen.getByRole("button", { name: "Commit changes" }));

    expect(await screen.findByText("Invalid file path")).toBeTruthy();
    expect(window.location.hash).toBe("#/organizations/demo-labs/repositories/file-management-demo/new");
  });
});
