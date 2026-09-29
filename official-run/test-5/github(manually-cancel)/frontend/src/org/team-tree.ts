import type { TeamSummary } from "./types";

export interface TeamTreeRow {
  team: TeamSummary;
  depth: number;
}

/**
 * Flattens the organization team hierarchy into display order. Parents that are
 * unknown or outside the organization are treated as roots and every team is
 * emitted at most once, so an unexpected cycle cannot loop forever.
 */
export function buildTeamTree(teams: readonly TeamSummary[]): TeamTreeRow[] {
  const known = new Map(teams.map((team) => [team.id, team]));
  const childrenOf = new Map<string | null, TeamSummary[]>();
  for (const team of teams) {
    const parentId =
      team.parentTeamId && known.has(team.parentTeamId) ? team.parentTeamId : null;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(team);
    childrenOf.set(parentId, siblings);
  }

  const rows: TeamTreeRow[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    const children = [...(childrenOf.get(parentId) ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const team of children) {
      if (visited.has(team.id)) continue;
      visited.add(team.id);
      rows.push({ team, depth });
      walk(team.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
