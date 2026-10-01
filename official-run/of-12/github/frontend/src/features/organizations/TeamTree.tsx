import type { OrganizationTeam } from "./org-api";

export interface TeamTreeProps {
  /** Organization identifier every team of the tree belongs to. */
  organization: string;
  teams: OrganizationTeam[];
  /** Team whose page is open; its entry is marked as the current page. */
  currentTeam?: string;
}

export interface TeamTreeNode {
  team: OrganizationTeam;
  children: TeamTreeNode[];
}

/**
 * Builds the display forest of an organization's teams. A team whose parent is
 * missing from the organization is shown as a root, so the tree always renders
 * every team of the organization.
 */
export function buildTeamTree(teams: OrganizationTeam[]): TeamTreeNode[] {
  const nodes = new Map<string, TeamTreeNode>(
    teams.map((team) => [team.name, { team, children: [] }]),
  );
  const roots: TeamTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.team.parentTeamName ? nodes.get(node.team.parentTeamName) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (left: TeamTreeNode, right: TeamTreeNode) => left.team.name.localeCompare(right.team.name);
  const sort = (list: TeamTreeNode[]): TeamTreeNode[] => {
    list.sort(byName);
    for (const node of list) sort(node.children);
    return list;
  };
  return sort(roots);
}

function TeamTreeList({ organization, nodes, currentTeam }: {
  organization: string;
  nodes: TeamTreeNode[];
  currentTeam?: string;
}) {
  return (
    <ul className="team-tree__list">
      {nodes.map((node) => (
        <li
          key={node.team.name}
          className="team-tree__item"
          aria-label={node.team.name}
        >
          <a
            className="team-tree__team"
            href={`#/organizations/${organization}/teams/${node.team.name}`}
            aria-current={node.team.name === currentTeam ? "page" : undefined}
          >
            {node.team.name}
          </a>
          {node.children.length > 0 ? (
            <TeamTreeList organization={organization} nodes={node.children} currentTeam={currentTeam} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Team tree of an organization (REQ-2-2-1 / REQ-2-2-2): the organization is the
 * root and every team hangs below the parent team it was assigned to, so the
 * hierarchy created or changed on the team pages is visible right away.
 */
export function TeamTree({ organization, teams, currentTeam }: TeamTreeProps) {
  const nodes = buildTeamTree(teams);
  return (
    <nav className="team-tree" aria-label="Team tree">
      <ul className="team-tree__list">
        <li
          className="team-tree__item team-tree__organization"
          aria-label={organization}
        >
          <a className="team-tree__organization-name" href={`#/organizations/${organization}`}>
            {organization}
          </a>
          {nodes.length > 0 ? (
            <TeamTreeList organization={organization} nodes={nodes} currentTeam={currentTeam} />
          ) : (
            <p className="team-tree__empty">This organization has no teams yet.</p>
          )}
        </li>
      </ul>
    </nav>
  );
}
