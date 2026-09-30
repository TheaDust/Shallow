import { describe, expect, it } from "vitest";

import { matchOrganizationRoute } from "./organization-routes";

describe("organization addresses", () => {
  it("resolves the list, the creation form and the organization overview", () => {
    expect(matchOrganizationRoute("/organizations")).toEqual({ kind: "list" });
    expect(matchOrganizationRoute("/organizations/new")).toEqual({ kind: "new" });
    expect(matchOrganizationRoute("/organizations/acme-demo")).toEqual({
      kind: "overview",
      login: "acme-demo",
    });
    // The GitHub-style single segment and the `orgs` prefix are aliases.
    expect(matchOrganizationRoute("/acme-demo")).toEqual({ kind: "overview", login: "acme-demo" });
    expect(matchOrganizationRoute("/orgs/acme-demo")).toEqual({
      kind: "overview",
      login: "acme-demo",
    });
  });

  it("resolves every tab page and the bare tab guess", () => {
    expect(matchOrganizationRoute("/organizations/acme-demo/repositories")).toEqual({
      kind: "tab",
      login: "acme-demo",
      tab: "repositories",
    });
    expect(matchOrganizationRoute("/organizations/acme-demo/people")).toEqual({
      kind: "tab",
      login: "acme-demo",
      tab: "people",
    });
    expect(matchOrganizationRoute("/orgs/acme-demo/teams")).toEqual({
      kind: "tab",
      login: "acme-demo",
      tab: "teams",
    });
    expect(matchOrganizationRoute("/acme-demo/teams")).toEqual({
      kind: "tab",
      login: "acme-demo",
      tab: "teams",
    });
  });

  it("resolves team pages, the team creation form and the team settings", () => {
    expect(matchOrganizationRoute("/organizations/acme-demo/teams/new")).toEqual({
      kind: "new-team",
      login: "acme-demo",
    });
    expect(matchOrganizationRoute("/organizations/acme-demo/teams/mobile-team")).toEqual({
      kind: "team",
      login: "acme-demo",
      team: "mobile-team",
    });
    expect(matchOrganizationRoute("/organizations/acme-demo/teams/mobile-team/members")).toEqual({
      kind: "team",
      login: "acme-demo",
      team: "mobile-team",
    });
    expect(matchOrganizationRoute("/organizations/acme-demo/teams/mobile-team/settings")).toEqual({
      kind: "team-settings",
      login: "acme-demo",
      team: "mobile-team",
    });
  });

  it("leaves account, repository and unknown pages to the other routes", () => {
    for (const path of [
      "/",
      "/settings",
      "/settings/password",
      "/workspace",
      "/repos/acme-demo/acme-docs",
      "/acme-demo/acme-docs",
      "/organizations/acme-demo/unknown",
      "/organizations/acme-demo/teams/mobile-team/unknown",
    ]) {
      expect(matchOrganizationRoute(path)).toBeNull();
    }
  });
});
