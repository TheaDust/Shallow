import type { OrganizationRole, OrganizationTeam } from "./org-api";
import { TeamTree } from "./TeamTree";

export interface OrganizationTeamsProps {
  /** Organization identifier taken from the address. */
  organization: string;
  teams: OrganizationTeam[];
  viewerRole: OrganizationRole | null;
  loading: boolean;
}

/**
 * Teams tab of the organization overview (REQ-2-2-1).
 *
 * The team tree shows the organization and every team with its parent-child
 * relationship. Only an organization Owner is offered the "New team" entry;
 * the server refuses team creation to everybody else.
 */
export function OrganizationTeams({ organization, teams, viewerRole, loading }: OrganizationTeamsProps) {
  return (
    <section className="org-teams" aria-label="Teams">
      {viewerRole === "Owner" ? (
        <p className="org-teams__new">
          <a href={`#/organizations/${organization}/teams/new`}>New team</a>
        </p>
      ) : null}
      {loading ? (
        <p role="status">Loading teams…</p>
      ) : (
        <TeamTree organization={organization} teams={teams} />
      )}
    </section>
  );
}
