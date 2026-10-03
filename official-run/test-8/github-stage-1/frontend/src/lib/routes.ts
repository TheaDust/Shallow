/**
 * Hash-route matcher for the whole application. It keeps the hand-rolled hash
 * routing used since the first stage while adding nested, parameterised paths
 * for organizations, teams and repositories.
 */

export type RouteName =
  | "home"
  | "signin"
  | "signup"
  | "forgot"
  | "settings"
  | "password-settings"
  | "signout"
  | "organizations"
  | "new-organization"
  | "organization"
  | "organization-repositories"
  | "organization-people"
  | "organization-teams"
  | "new-team"
  | "team"
  | "team-members"
  | "team-settings"
  | "repository"
  | "repository-settings"
  | "repository-access"
  | "not-found";

export interface MatchedRoute {
  name: RouteName;
  params: Record<string, string>;
}

export function matchRoute(path: string): MatchedRoute {
  const segments = path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));

  if (segments.length === 0) return { name: "home", params: {} };
  if (segments.length === 1) {
    switch (segments[0]) {
      case "signin":
        return { name: "signin", params: {} };
      case "signup":
        return { name: "signup", params: {} };
      case "forgot":
        return { name: "forgot", params: {} };
      case "settings":
        return { name: "settings", params: {} };
      case "signout":
        return { name: "signout", params: {} };
      case "organizations":
        return { name: "organizations", params: {} };
      default:
        return { name: "not-found", params: {} };
    }
  }

  if (segments[0] === "forgot" && segments[1] === "reset") return { name: "forgot", params: {} };
  if (segments[0] === "settings" && segments[1] === "password") return { name: "password-settings", params: {} };

  if (segments[0] === "repositories" && segments.length >= 3) {
    const org = segments[1];
    const repo = segments[2];
    if (segments.length === 3) return { name: "repository", params: { org, repo } };
    if (segments.length === 4 && segments[3] === "settings") {
      return { name: "repository-settings", params: { org, repo } };
    }
    if (segments.length === 5 && segments[3] === "settings" && segments[4] === "access") {
      return { name: "repository-access", params: { org, repo } };
    }
  }

  if (segments[0] === "organizations") {
    if (segments.length === 2 && segments[1] === "new") return { name: "new-organization", params: {} };
    const org = segments[1];
    if (segments.length === 2) return { name: "organization", params: { org } };
    if (segments.length === 3) {
      if (segments[2] === "repositories") return { name: "organization-repositories", params: { org } };
      if (segments[2] === "people") return { name: "organization-people", params: { org } };
      if (segments[2] === "teams") return { name: "organization-teams", params: { org } };
    }
    if (segments[2] === "teams" && segments.length === 4 && segments[3] === "new") {
      return { name: "new-team", params: { org } };
    }
    if (segments[2] === "teams" && segments.length >= 4) {
      const team = segments[3];
      if (segments.length === 4) return { name: "team", params: { org, team } };
      if (segments.length === 5 && segments[4] === "members") return { name: "team-members", params: { org, team } };
      if (segments.length === 5 && segments[4] === "settings") return { name: "team-settings", params: { org, team } };
    }
  }

  return { name: "not-found", params: {} };
}
