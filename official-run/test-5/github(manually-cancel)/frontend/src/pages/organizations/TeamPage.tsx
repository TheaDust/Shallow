import { fetchOrganizationTeams, fetchTeam, organizationHash, teamHash } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";
import { TeamMembersPanel } from "./TeamMembersPanel";
import { TeamSettingsPanel } from "./TeamSettingsPanel";

export interface TeamPageProps {
  organizationName: string;
  teamName: string;
  section: "members" | "settings";
}

/**
 * REQ-2-2-1 / REQ-2-2-2: the team detail page, titled “organization name/team
 * name”. “Members” and “Settings” are navigation links and both views are
 * directly openable and refreshable.
 */
export function TeamPage({ organizationName, teamName, section }: TeamPageProps) {
  const team = useAsyncData(() => fetchTeam(organizationName, teamName), [organizationName, teamName]);
  const teams = useAsyncData(() => fetchOrganizationTeams(organizationName), [organizationName]);

  if (team.status === "loading") return <BusyMain />;
  if (team.status === "error" || !team.data) {
    if (team.error && (team.error.status === 401 || team.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }

  const detail = team.data.team;
  const canManage = team.data.viewerRole === "owner";
  const base = teamHash(organizationName, detail.name);
  const reload = () => {
    team.reload();
    teams.reload();
  };

  return (
    <main>
      <h1>{`${detail.organizationName}/${detail.name}`}</h1>
      <nav className="team-tabs" aria-label="Team">
        <a
          className="team-tabs__link"
          href={`${base}/members`}
          aria-current={section === "members" ? "page" : undefined}
        >
          Members
        </a>
        <a
          className="team-tabs__link"
          href={`${base}/settings`}
          aria-current={section === "settings" ? "page" : undefined}
        >
          Settings
        </a>
      </nav>
      <dl className="team-hierarchy">
        <dt>Organization</dt>
        <dd>
          <a href={organizationHash(detail.organizationName)}>{detail.organizationName}</a>
        </dd>
        <dt>Parent</dt>
        <dd>
          {detail.parentName ? (
            <a href={teamHash(detail.organizationName, detail.parentName)}>{detail.parentName}</a>
          ) : (
            "None"
          )}
        </dd>
        <dt>Subteams</dt>
        <dd>
          {detail.children.length === 0
            ? "None"
            : detail.children.map((child, index) => (
                <span key={child}>
                  {index > 0 ? ", " : null}
                  <a href={teamHash(detail.organizationName, child)}>{child}</a>
                </span>
              ))}
        </dd>
      </dl>
      {section === "members" ? (
        <TeamMembersPanel
          organizationName={organizationName}
          team={detail}
          canManage={canManage}
          onChanged={reload}
        />
      ) : (
        <TeamSettingsPanel
          organizationName={organizationName}
          team={detail}
          teams={teams.data?.teams ?? []}
          canManage={canManage}
          onChanged={reload}
        />
      )}
    </main>
  );
}
