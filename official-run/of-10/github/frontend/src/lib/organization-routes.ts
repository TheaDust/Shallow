import { makeHash } from "./hash-route";
import { RESERVED_PREFIXES } from "./repository-routes";

/**
 * Organization addresses (REQ-2). The canonical spelling is
 * `#/organizations/<login>`, `#/orgs/…` is accepted as an alias and a single
 * segment `#/<login>` opens the same overview, so a directly typed organization
 * address resolves to the same view. Every organization sub-page supports direct
 * open and refresh because the router resolves it from the hash alone.
 */

export type OrganizationTab = "repositories" | "people" | "teams";

export type OrganizationRoute =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "overview"; login: string }
  | { kind: "tab"; login: string; tab: OrganizationTab }
  | { kind: "new-team"; login: string }
  | { kind: "team"; login: string; team: string }
  | { kind: "team-settings"; login: string; team: string };

const ORGANIZATION_PREFIXES = new Set(["organizations", "orgs"]);
const ORGANIZATION_TABS = new Set<OrganizationTab>(["repositories", "people", "teams"]);

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function matchOrganizationRoute(path: string): OrganizationRoute | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (segments.length === 1 && !RESERVED_PREFIXES.has(segments[0])) {
    return { kind: "overview", login: decode(segments[0]) };
  }

  // A bare `#/<login>/repositories|people|teams` guess resolves to the same tab
  // page instead of a repository that cannot exist.
  if (
    segments.length === 2 &&
    !RESERVED_PREFIXES.has(segments[0]) &&
    ORGANIZATION_TABS.has(segments[1] as OrganizationTab)
  ) {
    return { kind: "tab", login: decode(segments[0]), tab: segments[1] as OrganizationTab };
  }

  if (!ORGANIZATION_PREFIXES.has(segments[0])) return null;
  if (segments.length === 1) return { kind: "list" };
  if (segments.length === 2 && segments[1] === "new") return { kind: "new" };

  const login = decode(segments[1]);
  if (segments.length === 2) return { kind: "overview", login };

  if (segments[2] === "teams") {
    if (segments.length === 3) return { kind: "tab", login, tab: "teams" };
    if (segments.length === 4 && segments[3] === "new") return { kind: "new-team", login };
    const team = decode(segments[3]);
    if (segments.length === 4) return { kind: "team", login, team };
    if (segments.length === 5 && segments[4] === "settings") {
      return { kind: "team-settings", login, team };
    }
    if (segments.length === 5 && segments[4] === "members") return { kind: "team", login, team };
    return null;
  }

  if (segments.length === 3 && ORGANIZATION_TABS.has(segments[2] as OrganizationTab)) {
    return { kind: "tab", login, tab: segments[2] as OrganizationTab };
  }

  return null;
}

export function organizationsHref(): string {
  return makeHash("/organizations");
}

export function newOrganizationHref(): string {
  return makeHash("/organizations/new");
}

export function organizationPath(login: string, tab: OrganizationTab = "repositories"): string {
  return `/organizations/${encodeURIComponent(login)}/${tab}`;
}

export function organizationHref(login: string, tab: OrganizationTab = "repositories"): string {
  return makeHash(organizationPath(login, tab));
}

export function organizationTeamsHref(login: string): string {
  return organizationHref(login, "teams");
}

export function newTeamPath(login: string): string {
  return `/organizations/${encodeURIComponent(login)}/teams/new`;
}

export function newTeamHref(login: string): string {
  return makeHash(newTeamPath(login));
}

export function teamPath(login: string, team: string): string {
  return `/organizations/${encodeURIComponent(login)}/teams/${encodeURIComponent(team)}`;
}

export function teamHref(login: string, team: string): string {
  return makeHash(teamPath(login, team));
}

export function teamSettingsHref(login: string, team: string): string {
  return makeHash(`${teamPath(login, team)}/settings`);
}
