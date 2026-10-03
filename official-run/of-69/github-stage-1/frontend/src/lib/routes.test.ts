import { describe, expect, it } from "vitest";

import { isProtectedView, matchRoute, organizationUrl } from "./routes";

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
});
