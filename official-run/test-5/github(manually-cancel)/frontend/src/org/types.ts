/** Shared payload types of the organization module (REQ-2). Repository payload
 * types live in `repo/types.ts` and are re-exported here for the organization views. */

export type { RepositoryDetail, RepositorySummary, RepositoryVisibility } from "../repo/types";

export type OrganizationRole = "owner" | "member";

/** Repository role matrix (REQ-2-3), ordered Read < Triage < Write < Maintain < Admin. */
export type RepositoryRole = "read" | "triage" | "write" | "maintain" | "admin";

export interface OrganizationSummary {
  name: string;
  displayName: string;
  role: OrganizationRole | null;
}

export interface OrganizationDetail {
  name: string;
  displayName: string;
  createdAt: string | null;
  role: OrganizationRole | null;
  isMember: boolean;
}

export interface OrganizationMember {
  username: string;
  role: OrganizationRole;
}

/** Organization member add/remove form values (REQ-2-2-3). */
export interface OrganizationMemberFormValues {
  identifier: string;
  role: OrganizationRole;
}

export interface OrganizationMemberErrors {
  identifier?: string;
  role?: string;
}

/** A selectable repository-access subject: an organization member or a team. */
export interface AccessSubject {
  id: string;
  name: string;
}

export interface RepositoryGrant {
  id: string;
  subjectType: "account" | "team";
  subjectId: string;
  subjectName: string;
  role: RepositoryRole;
  createdAt: string | null;
}

/** Payload of the “Manage access” view (REQ-2-3). */
export interface RepositoryAccess {
  grants: RepositoryGrant[];
  members: AccessSubject[];
  teams: AccessSubject[];
  viewerRole: RepositoryRole | null;
}

export interface RepositoryGrantFormValues {
  subjectType: "account" | "team";
  subjectId: string;
  role: RepositoryRole;
}

export interface RepositoryGrantErrors {
  role?: string;
  subject?: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string;
  parentTeamId: string | null;
  parentName: string | null;
}

export interface TeamDetail extends TeamSummary {
  organizationId: string;
  organizationName: string;
  createdAt: string | null;
  members: string[];
  children: string[];
}

export interface OrganizationFormValues {
  name: string;
  displayName: string;
}

export interface OrganizationErrors {
  name?: string;
  displayName?: string;
}

export interface TeamFormValues {
  name: string;
  description: string;
  parentTeamId: string;
}

export interface TeamErrors {
  name?: string;
  description?: string;
  parentTeamId?: string;
}

export interface TeamMemberErrors {
  username?: string;
}
