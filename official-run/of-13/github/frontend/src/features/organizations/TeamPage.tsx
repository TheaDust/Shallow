import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { useDocumentTitle } from "../../lib/document-title";
import {
  fetchOrganizationTeams,
  fetchTeam,
  type TeamDetail,
} from "../../lib/organizations-api";
import { TeamMembersPanel } from "./TeamMembersPanel";
import { TeamSettingsPanel } from "./TeamSettingsPanel";

export interface TeamPageProps {
  organizationName: string;
  teamName: string;
  tab: string;
}

const TABS = [
  { id: "members", label: "Members" },
  { id: "settings", label: "Settings" },
] as const;

type LoadState = "loading" | "ready" | "missing" | "error";

/**
 * Team detail page, titled "organization name/team name". The Members tab
 * shows the direct members, Settings changes the parent team.
 */
export function TeamPage({ organizationName, teamName, tab }: TeamPageProps) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [parentOptions, setParentOptions] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const activeTab = TABS.some((item) => item.id === tab) ? tab : "members";
  useDocumentTitle(`${organizationName}/${teamName}`);

  const load = useCallback(async () => {
    const nextDetail = await fetchTeam(organizationName, teamName);
    const teams = await fetchOrganizationTeams(organizationName);
    setDetail(nextDetail);
    setParentOptions(teams.map((team) => team.name));
    setLoadState("ready");
  }, [organizationName, teamName]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    load().catch((error) => {
      if (cancelled) return;
      setLoadState(error instanceof ApiError && error.status === 404 ? "missing" : "error");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load().catch(() => setLoadState("error"));
  }, [load]);

  return (
    <div className="team-page">
      <h1>{`${organizationName}/${teamName}`}</h1>
      {loadState === "missing" ? <p role="status">Team not found.</p> : null}
      {loadState === "error" ? (
        <p className="form-error" role="alert">
          Unable to load this team right now.
        </p>
      ) : null}
      {loadState === "loading" ? <p role="status">Loading…</p> : null}
      {detail ? (
        <>
          <p className="team-page__organization">{`Organization: ${detail.organization.name}`}</p>
          <p className="team-page__parent">
            {detail.team.parent
              ? `Parent team: ${detail.team.parent}`
              : "Parent team: none"}
          </p>
          {detail.team.description ? (
            <p className="team-page__description">{detail.team.description}</p>
          ) : null}
          <nav className="organization-tabs" aria-label="Team">
            {TABS.map((item) => (
              <a
                key={item.id}
                className="organization-tabs__link"
                href={`#/organizations/${organizationName}/teams/${teamName}?tab=${item.id}`}
                aria-current={activeTab === item.id ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {activeTab === "members" ? (
            <TeamMembersPanel
              organizationName={organizationName}
              teamName={teamName}
              members={detail.members}
              canManage={detail.canManage}
              onChanged={refresh}
            />
          ) : null}
          {activeTab === "settings" ? (
            <TeamSettingsPanel
              organizationName={organizationName}
              teamName={teamName}
              team={detail.team}
              parentOptions={parentOptions}
              canManage={detail.canManage}
              onChanged={refresh}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
