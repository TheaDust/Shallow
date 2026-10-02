export type OrganizationRole = "owner" | "member";

export type RepositoryVisibility = "public" | "private";

/** Operation-specific repository roles; only `admin` may manage access. */
export type RepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";

export interface Organization {
  slug: string;
  name: string;
  displayName: string;
  createdAt?: string;
}

export interface OrganizationMembership extends Organization {
  role: OrganizationRole;
}

export interface OrganizationOverview {
  organization: Organization;
  role: OrganizationRole | null;
}

export interface OrganizationMember {
  username: string;
  role: OrganizationRole;
}

/** Direct addition of an existing account; `identifier` is a username or email. */
export interface AddOrganizationMemberInput {
  identifier: string;
  role: OrganizationRole;
}

export interface OrganizationTeam {
  id: string;
  name: string;
  parentTeamId: string | null;
}

/** Public overview of one team: its own record, the owning organization and the
 * viewer's organization role, plus every team of the organization so that the
 * parent-team combobox can offer the same-organization candidates. */
export interface TeamOverview {
  team: OrganizationTeam;
  parentTeam: OrganizationTeam | null;
  organization: Organization;
  role: OrganizationRole | null;
  teams: OrganizationTeam[];
}

export interface TeamMember {
  username: string;
}

export interface CreateTeamInput {
  name: string;
}

export interface RepositorySummary {
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  updatedAt: string;
  createdAt?: string;
}

export interface RepositoryOverview extends RepositorySummary {
  organization: Organization;
  /** Only an organization Owner or a repository Admin sees the Settings entry. */
  canManageAccess?: boolean;
}

/** One row of the repository "Manage access" list: a team or an account. */
export interface RepositoryAccessGrant {
  id: string;
  kind: "team" | "account";
  name: string;
  role: RepositoryRole;
}

/** Repository Settings/Manage access payload with the picker's team candidates. */
export interface RepositoryAccessOverview {
  repository: RepositoryOverview;
  canManageAccess: boolean;
  grants: RepositoryAccessGrant[];
  teams: OrganizationTeam[];
}

export interface CreateOrganizationInput {
  name: string;
  displayName: string;
}
