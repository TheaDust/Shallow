import { useEffect, useState } from "react";

import {
  fetchOrganizationTeams,
  type OrganizationSummary,
  type OrganizationTeam,
  type OrganizationViewer,
} from "../lib/organizations-api";
import { newTeamHref, teamHref } from "../lib/organization-routes";

type LoadState = "loading" | "ready" | "forbidden" | "error";

interface TeamNode {
  team: OrganizationTeam;
  children: TeamNode[];
}

/** Nested view of the persisted parent relationships of one organization. */
function buildTeamTree(teams: OrganizationTeam[]): TeamNode[] {
  const nodes = new Map<string, TeamNode>(
    teams.map((team) => [team.id, { team, children: [] }]),
  );
  const roots: TeamNode[] = [];
  for (const team of teams) {
    const node = nodes.get(team.id);
    if (!node) continue;
    const parent = team.parent ? nodes.get(team.parent.id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function TeamTree({ login, nodes }: { login: string; nodes: TeamNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="organization-team-tree">
      {nodes.map((node) => (
        <li key={node.team.id} className="organization-team-tree__item">
          <a href={teamHref(login, node.team.name)}>{node.team.name}</a>
          {node.team.description ? (
            <span className="organization-team-tree__description">{node.team.description}</span>
          ) : null}
          <TeamTree login={login} nodes={node.children} />
        </li>
      ))}
    </ul>
  );
}

export interface OrganizationTeamsPanelProps {
  organization: OrganizationSummary;
}

/**
 * "Teams" tab of the organization overview (REQ-2-1-1, REQ-2-2-1). Every team
 * links to its detail page; the "New team" entry exists only for an organization
 * Owner, and the server refuses team creation for anybody else.
 */
export function OrganizationTeamsPanel({ organization }: OrganizationTeamsPanelProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [viewer, setViewer] = useState<OrganizationViewer | null>(null);
  const [teams, setTeams] = useState<OrganizationTeam[]>([]);

  useEffect(() => {
    let active = true;
    setState("loading");
    fetchOrganizationTeams(organization.login)
      .then(
        (payload) => {
          if (!active) return;
          setViewer(payload.viewer);
          setTeams(payload.teams);
          setState("ready");
        },
        (error: unknown) => {
          if (!active) return;
          setState((error as { status?: number }).status === 403 ? "forbidden" : "error");
        },
      );
    return () => {
      active = false;
    };
  }, [organization.login]);

  return (
    <section className="organization-teams" aria-labelledby="organization-teams-heading">
      <h2 id="organization-teams-heading">Teams</h2>
      {state === "loading" ? (
        <p role="status">Loading teams…</p>
      ) : state === "forbidden" ? (
        <p role="alert">You must be an organization member to view its teams.</p>
      ) : state === "error" ? (
        <p role="alert">The teams could not be loaded. Reload the page to try again.</p>
      ) : (
        <>
          {viewer?.isOwner ? (
            <p>
              <a href={newTeamHref(organization.login)}>New team</a>
            </p>
          ) : null}
          {teams.length === 0 ? (
            <p>This organization has no teams yet.</p>
          ) : (
            <TeamTree login={organization.login} nodes={buildTeamTree(teams)} />
          )}
        </>
      )}
    </section>
  );
}
