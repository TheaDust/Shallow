import { describe, expect, it } from "vitest";

import {
  isProtectedView,
  matchRoute,
  organizationUrl,
  repositoryCodeSearchPath,
  repositoryCodeUrl,
  repositoryCommitUrl,
  repositoryCommitsUrl,
  repositoryContextForPath,
  repositoryBranchesSettingsUrl,
  repositoryNewFileUrl,
} from "./routes";

describe("hash route table", () => {
  it("maps the organization pages to their views", () => {
    expect(matchRoute("/organizations")).toEqual({ view: "organizations" });
    expect(matchRoute("/organizations/new")).toEqual({ view: "organizations-new" });
    expect(matchRoute("/organizations/acme-demo")).toEqual({
      view: "organization-overview",
      organization: "acme-demo",
    });
    expect(matchRoute("/organizations/acme-demo/repositories")).toEqual({
      view: "organization-repositories",
      organization: "acme-demo",
    });
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs")).toEqual({
      view: "repository-overview",
      organization: "acme-demo",
      repository: "acme-docs",
    });
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs/settings")).toEqual({
      view: "repository-settings",
      organization: "acme-demo",
      repository: "acme-docs",
    });
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs/settings/access")).toEqual({
      view: "repository-access",
      organization: "acme-demo",
      repository: "acme-docs",
    });
    expect(matchRoute("/organizations/acme-demo/people")).toEqual({
      view: "organization-people",
      organization: "acme-demo",
    });
    expect(matchRoute("/organizations/acme-demo/teams")).toEqual({
      view: "organization-teams",
      organization: "acme-demo",
    });
    expect(matchRoute("/organizations/acme-demo/teams/new")).toEqual({
      view: "organization-team-new",
      organization: "acme-demo",
    });
    expect(matchRoute("/organizations/acme-demo/teams/frontend-team")).toEqual({
      view: "team-overview",
      organization: "acme-demo",
      team: "frontend-team",
    });
    expect(matchRoute("/organizations/acme-demo/teams/frontend-team/members")).toEqual({
      view: "team-members",
      organization: "acme-demo",
      team: "frontend-team",
    });
    expect(matchRoute("/organizations/acme-demo/teams/frontend-team/settings")).toEqual({
      view: "team-settings",
      organization: "acme-demo",
      team: "frontend-team",
    });
  });

  it("keeps the existing pages and falls back to home", () => {
    expect(matchRoute("/")).toEqual({ view: "home" });
    expect(matchRoute("/settings/password")).toEqual({ view: "settings-password" });
    expect(matchRoute("/not-a-page")).toEqual({ view: "home" });
    expect(matchRoute("/organizations/acme-demo/unknown-section")).toEqual({ view: "home" });
  });

  it("marks only the account-scoped pages as protected", () => {
    expect(isProtectedView(matchRoute("/organizations"))).toBe(true);
    expect(isProtectedView(matchRoute("/organizations/new"))).toBe(true);
    expect(isProtectedView(matchRoute("/organizations/acme-demo"))).toBe(false);
    expect(isProtectedView(matchRoute("/organizations/acme-demo/repositories"))).toBe(false);
  });

  it("builds organization URLs from the identifier", () => {
    expect(organizationUrl("acme-demo")).toBe("#/organizations/acme-demo");
    expect(organizationUrl("acme-demo", "teams", "frontend-team", "members")).toBe(
      "#/organizations/acme-demo/teams/frontend-team/members",
    );
  });

  it("maps the read-only code views of both repository kinds", () => {
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs/commits")).toEqual({
      view: "repository-commits",
      ownerType: "organization",
      owner: "acme-demo",
      repository: "acme-docs",
    });
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs/commit/commit-acme-docs-3")).toEqual({
      view: "repository-commit",
      ownerType: "organization",
      owner: "acme-demo",
      repository: "acme-docs",
      commitId: "commit-acme-docs-3",
    });
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs/search")).toEqual({
      view: "repository-search",
      ownerType: "organization",
      owner: "acme-demo",
      repository: "acme-docs",
    });
    expect(matchRoute("/users/fork-user/repositories/acme-docs-copy/commits")).toEqual({
      view: "repository-commits",
      ownerType: "user",
      owner: "fork-user",
      repository: "acme-docs-copy",
    });
    expect(matchRoute("/users/fork-user/repositories/acme-docs-copy/search")).toEqual({
      view: "repository-search",
      ownerType: "user",
      owner: "fork-user",
      repository: "acme-docs-copy",
    });
    expect(matchRoute("/users/fork-user/repositories/acme-docs-copy/commit/abc")).toEqual({
      view: "repository-commit",
      ownerType: "user",
      owner: "fork-user",
      repository: "acme-docs-copy",
      commitId: "abc",
    });
    // Unknown suffixes stay on the home page.
    expect(matchRoute("/organizations/acme-demo/repositories/acme-docs/unknown")).toEqual({ view: "home" });
    expect(matchRoute("/users/fork-user/repositories/acme-docs-copy/unknown")).toEqual({ view: "home" });
  });

  it("addresses the code page, its files and the history it links", () => {
    const owner = { type: "organization" as const, name: "acme-demo" };
    expect(repositoryCodeUrl(owner, "acme-docs")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs",
    );
    expect(repositoryCodeUrl(owner, "acme-docs", { path: "src" })).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?path=src",
    );
    expect(repositoryCodeUrl(owner, "acme-docs", { file: "README.md" })).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?file=README.md",
    );
    expect(repositoryCodeUrl(owner, "acme-docs", { path: "src", file: "src/README.md" })).toBe(
      "#/organizations/acme-demo/repositories/acme-docs?path=src&file=src%2FREADME.md",
    );
    expect(repositoryCommitsUrl("organization", "acme-demo", "acme-docs")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/commits",
    );
    expect(repositoryCommitUrl("organization", "acme-demo", "acme-docs", "commit-3")).toBe(
      "#/organizations/acme-demo/repositories/acme-docs/commit/commit-3",
    );
    expect(repositoryCodeSearchPath("organization", "acme-demo", "acme-docs", "search flow")).toBe(
      "/organizations/acme-demo/repositories/acme-docs/search?q=search+flow",
    );
  });

  it("addresses the new-file editor and the branch settings of both repository kinds", () => {
    const owner = { type: "organization" as const, name: "demo-labs" };
    expect(repositoryNewFileUrl(owner, "file-management-demo")).toBe(
      "#/organizations/demo-labs/repositories/file-management-demo/new",
    );
    expect(repositoryNewFileUrl(owner, "branch-switch-demo", { branch: "feature-search" })).toBe(
      "#/organizations/demo-labs/repositories/branch-switch-demo/new?branch=feature-search",
    );
    expect(repositoryBranchesSettingsUrl("demo-labs", "default-branch-demo")).toBe(
      "#/organizations/demo-labs/repositories/default-branch-demo/settings/branches",
    );
    expect(matchRoute("/organizations/demo-labs/repositories/file-management-demo/new")).toEqual({
      view: "repository-new-file",
      ownerType: "organization",
      owner: "demo-labs",
      repository: "file-management-demo",
    });
    expect(matchRoute("/users/fork-user/repositories/acme-docs-copy/new")).toEqual({
      view: "repository-new-file",
      ownerType: "user",
      owner: "fork-user",
      repository: "acme-docs-copy",
    });
    expect(matchRoute("/organizations/demo-labs/repositories/default-branch-demo/settings/branches")).toEqual({
      view: "repository-settings-branches",
      organization: "demo-labs",
      repository: "default-branch-demo",
    });
    expect(isProtectedView(matchRoute("/organizations/demo-labs/repositories/file-management-demo/new"))).toBe(true);
    expect(
      isProtectedView(matchRoute("/organizations/demo-labs/repositories/default-branch-demo/settings/branches")),
    ).toBe(false);
    expect(repositoryContextForPath("/organizations/demo-labs/repositories/default-branch-demo/settings/branches")).toEqual({
      ownerType: "organization",
      owner: "demo-labs",
      repository: "default-branch-demo",
    });
    expect(repositoryContextForPath("/organizations/demo-labs/repositories/file-management-demo/new")).toEqual({
      ownerType: "organization",
      owner: "demo-labs",
      repository: "file-management-demo",
    });
  });

  it("resolves the repository a path belongs to for the scoped search box", () => {
    expect(repositoryContextForPath("/organizations/acme-demo/repositories/acme-docs")).toEqual({
      ownerType: "organization",
      owner: "acme-demo",
      repository: "acme-docs",
    });
    expect(repositoryContextForPath("/organizations/acme-demo/repositories/acme-docs/settings/access")).toEqual({
      ownerType: "organization",
      owner: "acme-demo",
      repository: "acme-docs",
    });
    expect(repositoryContextForPath("/users/fork-user/repositories/acme-docs-copy/commits")).toEqual({
      ownerType: "user",
      owner: "fork-user",
      repository: "acme-docs-copy",
    });
    expect(repositoryContextForPath("/organizations/acme-demo/repositories")).toBeNull();
    expect(repositoryContextForPath("/search")).toBeNull();
    expect(repositoryContextForPath("/")).toBeNull();
  });
});
