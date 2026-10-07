import { AppHeader } from "../components/AppHeader";
import { TeamMembers } from "../components/TeamMembers";
import { TeamSettings } from "../components/TeamSettings";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchTeam } from "../lib/org-api";
import { organizationHash, teamHash, type TeamTab } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

const TABS: ReadonlyArray<readonly [TeamTab, string]> = [
  ["members", "Members"],
  ["settings", "Settings"],
];

/** Team overview: the team name is the heading, Members and Settings are links. */
export function TeamPage({
  organizationId,
  teamName,
  tab,
}: {
  organizationId: string;
  teamName: string;
  tab: TeamTab;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchTeam(organizationId, teamName),
    [organizationId, teamName],
  );

  if (status === "error" && error) {
    return (
      <main className="page">
        <AppHeader />
        <section className="page__body team">
          <ErrorHeading error={error} />
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body team">
        <nav className="team__breadcrumb" aria-label="Breadcrumb">
          <a href={organizationHash(organizationId, "teams")}>Teams</a>
        </nav>
        <h1 className="team__title">{data ? data.name : teamName}</h1>
        <nav className="page-tabs" aria-label="Team">
          {TABS.map(([id, label]) => (
            <a
              key={id}
              className="page-tabs__link"
              href={teamHash(organizationId, teamName, id)}
              aria-current={tab === id ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        {status === "loading" ? <LoadingNote label="Loading team…" /> : null}
        {data && tab === "members" ? (
          <TeamMembers organizationId={organizationId} teamName={teamName} />
        ) : null}
        {data && tab === "settings" ? (
          <TeamSettings organizationId={organizationId} teamName={teamName} />
        ) : null}
      </section>
    </main>
  );
}
