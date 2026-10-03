/**
 * Hash-route table. Every page that the product documents is reachable by URL
 * so it can be opened directly and survives a refresh.
 */
export type Route =
  | { view: "home" }
  | { view: "signin" }
  | { view: "signup" }
  | { view: "recover" }
  | { view: "workspace" }
  | { view: "settings" }
  | { view: "settings-password" }
  | { view: "organizations" }
  | { view: "organizations-new" }
  | { view: "organization-overview"; organization: string }
  | { view: "organization-repositories"; organization: string }
  | { view: "repository-overview"; organization: string; repository: string }
  | { view: "repository-settings"; organization: string; repository: string }
  | { view: "repository-access"; organization: string; repository: string }
  | { view: "organization-people"; organization: string }
  | { view: "organization-teams"; organization: string }
  | { view: "organization-team-new"; organization: string }
  | { view: "team-overview"; organization: string; team: string }
  | { view: "team-members"; organization: string; team: string }
  | { view: "team-settings"; organization: string; team: string };

const SIMPLE_ROUTES: Record<string, Route> = {
  signin: { view: "signin" },
  signup: { view: "signup" },
  recover: { view: "recover" },
  workspace: { view: "workspace" },
  settings: { view: "settings" },
};

export function matchRoute(path: string): Route {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 1 && SIMPLE_ROUTES[segments[0]]) return SIMPLE_ROUTES[segments[0]];
  if (segments.length === 2 && segments[0] === "settings" && segments[1] === "password") {
    return { view: "settings-password" };
  }
  if (segments[0] !== "organizations") return { view: "home" };

  if (segments.length === 1) return { view: "organizations" };
  if (segments.length === 2 && segments[1] === "new") return { view: "organizations-new" };
  if (segments.length === 2) return { view: "organization-overview", organization: segments[1] };

  const [, organization, section, child, grandChild] = segments;
  if (segments.length === 3) {
    if (section === "repositories") return { view: "organization-repositories", organization };
    if (section === "people") return { view: "organization-people", organization };
    if (section === "teams") return { view: "organization-teams", organization };
    return { view: "home" };
  }
  if (section === "repositories") {
    if (segments.length === 4) return { view: "repository-overview", organization, repository: child };
    if (segments.length === 5 && grandChild === "settings") {
      return { view: "repository-settings", organization, repository: child };
    }
    if (segments.length === 6 && grandChild === "settings" && segments[5] === "access") {
      return { view: "repository-access", organization, repository: child };
    }
    return { view: "home" };
  }
  if (section === "teams") {
    if (segments.length === 4 && child === "new") return { view: "organization-team-new", organization };
    if (segments.length === 4) return { view: "team-overview", organization, team: child };
    if (segments.length === 5 && grandChild === "members") return { view: "team-members", organization, team: child };
    if (segments.length === 5 && grandChild === "settings") return { view: "team-settings", organization, team: child };
  }
  return { view: "home" };
}

/** Views that require a signed-in account before they can render. */
export function isProtectedView(route: Route): boolean {
  switch (route.view) {
    case "workspace":
    case "settings":
    case "settings-password":
    case "organizations":
    case "organizations-new":
    case "organization-team-new":
      return true;
    default:
      return false;
  }
}

/** Canonical route path for an organization page (also used by `navigate`). */
export function organizationPath(organization: string, ...rest: string[]): string {
  return `/organizations/${[organization, ...rest].map(encodeURIComponent).join("/")}`;
}

export function organizationUrl(organization: string, ...rest: string[]): string {
  return `#${organizationPath(organization, ...rest)}`;
}
