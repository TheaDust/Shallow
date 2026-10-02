import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { fetchTeam, type TeamDetail } from "../features/organizations/org-api";
import { TeamMembers } from "../features/organizations/TeamMembers";
import { TeamSettings } from "../features/organizations/TeamSettings";
import { TeamTree } from "../features/organizations/TeamTree";
import { NotFoundPage } from "./NotFoundPage";

export type TeamTab = "members" | "settings";

export interface TeamPageProps {
  /** Organization identifier taken from the address. */
  organization: string;
  /** Team name taken from the address; the heading uses it right away. */
  team: string;
  tab: TeamTab;
}

const TABS: Array<{ id: TeamTab; label: string }> = [
  { id: "members", label: "Members" },
  { id: "settings", label: "Settings" },
];

export function isTeamTab(value: string): value is TeamTab {
  return TABS.some((tab) => tab.id === value);
}

type LoadState = "loading" | "ready" | "missing" | "failed";

/**
 * Team detail page (REQ-2-2-1 / REQ-2-2-2): titled "organization name/team
 * name", with the Members and Settings links, the team tree of the
 * organization and the management panels an organization Owner may use.
 */
export function TeamPage({ organization, team, tab }: TeamPageProps) {
  const { user } = useSession();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setDetail(null);
    setState("loading");
  }, [organization, team]);

  useEffect(() => {
    let active = true;
    fetchTeam(organization, team)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiError && error.status === 404 ? "missing" : "failed");
      });
    return () => {
      active = false;
    };
  }, [organization, team, reloadToken]);

  if (state === "missing") return <NotFoundPage />;

  const canManage = detail?.viewerRole === "Owner";
  const reload = () => setReloadToken((token) => token + 1);

  return (
    <main className="team-page">
      <h1 className="team-page__title">{`${organization}/${team}`}</h1>
      {detail?.team.description ? (
        <p className="team-page__description">{detail.team.description}</p>
      ) : null}

      {detail ? (
        <TeamTree organization={detail.organization.name} teams={detail.teams} currentTeam={detail.team.name} />
      ) : null}

      <nav className="team-page__tabs" aria-label="Team">
        {TABS.map((entry) => (
          <a
            key={entry.id}
            className="team-page__tab"
            href={`#/organizations/${organization}/teams/${team}/${entry.id}`}
            aria-current={entry.id === tab ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>

      {state === "failed" ? (
        <p role="alert">The team could not be loaded. Please try again.</p>
      ) : null}

      {!detail && state !== "failed" ? <p role="status">Loading team…</p> : null}

      {detail && !detail.viewerRole ? (
        <p className="team-page__restricted">
          Sign in as an organization member to view this team.{" "}
          <a href="#/sign-in">{user ? "Switch account" : "Sign in"}</a>
        </p>
      ) : null}

      {detail && detail.viewerRole && tab === "members" ? (
        <TeamMembers
          organization={organization}
          team={detail.team.name}
          members={detail.members}
          canManage={canManage}
          onChanged={reload}
        />
      ) : null}

      {detail && detail.viewerRole && tab === "settings" ? (
        <TeamSettings
          organization={organization}
          team={detail.team.name}
          parentTeamName={detail.team.parentTeamName ?? null}
          teams={detail.teams}
          canManage={canManage}
          onSaved={reload}
        />
      ) : null}
    </main>
  );
}
