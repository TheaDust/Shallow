import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { fetchTeam } from "../organizations/api";
import { TeamMembers } from "../organizations/TeamMembers";
import { TeamSettings } from "../organizations/TeamSettings";
import type { TeamOverview } from "../organizations/types";

export type TeamSection = "members" | "settings";

export const TEAM_SECTIONS: readonly TeamSection[] = ["members", "settings"];

export function isTeamSection(value: string): value is TeamSection {
  return (TEAM_SECTIONS as readonly string[]).includes(value);
}

const NAV_ENTRIES: readonly { id: TeamSection; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "settings", label: "Settings" },
];

export interface TeamPageProps {
  slug: string;
  name: string;
  /** Active entry; without a section the team overview is shown. */
  section?: TeamSection;
}

/**
 * Team overview of one organization. The heading is the team name, the
 * organization breadcrumb returns to the organization overview and the Members
 * and Settings entries are real links, so each one can be opened and refreshed
 * directly. Every management action is limited to an organization Owner.
 */
export function TeamPage({ slug, name, section }: TeamPageProps) {
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    setNotFound(false);
    setFailed(false);
    fetchTeam(slug, name)
      .then((next) => {
        if (!cancelled) setOverview(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setNotFound(true);
        else setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, name]);

  if (notFound) {
    return (
      <section className="page page--narrow">
        <h1>Team not found</h1>
        <p className="page__lead">The address does not match a team of this organization.</p>
        <p className="page__links">
          <a href={`#/organizations/${slug}/teams`}>Teams</a>
        </p>
      </section>
    );
  }

  if (failed) {
    return (
      <section className="page page--narrow">
        <p role="alert">We could not load this team. Try again.</p>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="page">
        <p role="status">Loading team…</p>
      </section>
    );
  }

  const { organization, team, parentTeam, teams, role } = overview;
  const canManage = role === "owner";
  const teamBase = `#/organizations/${slug}/teams/${team.name}`;

  return (
    <section className="page">
      <p className="org-breadcrumb">
        <a className="org-breadcrumb__organization" href={`#/organizations/${slug}`}>
          {organization.name}
        </a>
      </p>
      <h1>{team.name}</h1>
      <nav className="org-tabs" aria-label="Team">
        {NAV_ENTRIES.map((entry) => (
          <a
            key={entry.id}
            className="org-tabs__entry"
            href={`${teamBase}/${entry.id}`}
            aria-current={entry.id === section ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {section === undefined ? (
        <p className="page__lead">
          {team.name} is a team of {organization.name}. Use the entries above to manage its
          membership and its place in the team hierarchy.
        </p>
      ) : null}
      {section === "members" ? (
        <TeamMembers slug={slug} teamName={team.name} canManage={canManage} />
      ) : null}
      {section === "settings" ? (
        <TeamSettings
          slug={slug}
          teamName={team.name}
          savedParentName={parentTeam?.name ?? ""}
          teams={teams}
          canManage={canManage}
        />
      ) : null}
    </section>
  );
}
