import { ApiError } from "../../lib/api";
import { fetchOrganization, fetchOrganizationTeams, organizationHash, teamHash } from "../../org/org-api";
import { buildTeamTree } from "../../org/team-tree";
import { useAsyncData } from "../../org/use-async-data";
import { BusyMain, NotFoundPage, PanelMessage } from "../common";
import { OrganizationShell } from "./OrganizationShell";

export interface OrganizationTeamsPageProps {
  organizationName: string;
}

function accessMessage(error: ApiError): string {
  return error.status === 401
    ? "Sign in as an organization member to see the teams of this organization."
    : "You need to be an organization member to see the teams of this organization.";
}

/**
 * REQ-2-1 / REQ-2-2-1: the Teams tab lists the organization's teams as a tree and
 * offers “New team” to an organization Owner.
 */
export function OrganizationTeamsPage({ organizationName }: OrganizationTeamsPageProps) {
  const organization = useAsyncData(() => fetchOrganization(organizationName), [organizationName]);
  const teams = useAsyncData(() => fetchOrganizationTeams(organizationName), [organizationName]);

  if (organization.status === "loading") return <BusyMain />;
  if (organization.status === "error" || !organization.data) return <NotFoundPage />;

  const rows = buildTeamTree(teams.data?.teams ?? []);

  return (
    <OrganizationShell organization={organization.data} activeTab="teams">
      <section className="org-teams" aria-label="Teams">
        <h2>Teams</h2>
        {teams.status === "error" && teams.error ? (
          <PanelMessage>{accessMessage(teams.error)}</PanelMessage>
        ) : null}
        {teams.status === "loading" ? <p role="status">Loading teams…</p> : null}
        {teams.status === "ready" ? (
          <>
            {teams.data?.viewerRole === "owner" ? (
              <p>
                <a href={organizationHash(organizationName, "/teams/new")}>New team</a>
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p>No teams yet.</p>
            ) : (
              <ul className="team-tree">
                {rows.map(({ team, depth }) => (
                  <li key={team.id} style={{ paddingLeft: `${depth * 1.5}rem` }}>
                    <a href={teamHash(organizationName, team.name)}>{team.name}</a>
                    {team.parentName ? (
                      <span className="team-tree__parent"> · parent: {team.parentName}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </OrganizationShell>
  );
}
