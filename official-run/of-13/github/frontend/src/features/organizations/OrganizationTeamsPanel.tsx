import type { OrganizationTeam } from "../../lib/organizations-api";

export interface OrganizationTeamsPanelProps {
  organizationName: string;
  teams: OrganizationTeam[];
  canManage: boolean;
}

function childrenOf(teams: OrganizationTeam[], parent: string | null): OrganizationTeam[] {
  return teams.filter((team) => (team.parent ?? null) === parent);
}

function TeamTree({
  organizationName,
  teams,
  parent,
}: {
  organizationName: string;
  teams: OrganizationTeam[];
  parent: string | null;
}) {
  const nodes = childrenOf(teams, parent);
  if (nodes.length === 0) return null;
  return (
    <ul className="team-tree">
      {nodes.map((team) => (
        <li key={team.name} className="team-tree__item">
          <a href={`#/organizations/${organizationName}/teams/${team.name}`}>{team.name}</a>
          {team.parent ? (
            <span className="team-tree__parent">{`Parent team: ${team.parent}`}</span>
          ) : null}
          {team.description ? (
            <p className="team-tree__description">{team.description}</p>
          ) : null}
          <TeamTree organizationName={organizationName} teams={teams} parent={team.name} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The "Teams" tab: the organization team tree plus the Owner-only "New team"
 * entry. Team hierarchy is display data only and adds no membership.
 */
export function OrganizationTeamsPanel({
  organizationName,
  teams,
  canManage,
}: OrganizationTeamsPanelProps) {
  return (
    <section className="organization-teams" aria-label="Teams">
      {canManage ? (
        <p className="organization-teams__actions">
          <a href={`#/organizations/${organizationName}/teams/new`}>New team</a>
        </p>
      ) : null}
      {teams.length === 0 ? <p role="status">No teams yet.</p> : null}
      <TeamTree organizationName={organizationName} teams={teams} parent={null} />
    </section>
  );
}
