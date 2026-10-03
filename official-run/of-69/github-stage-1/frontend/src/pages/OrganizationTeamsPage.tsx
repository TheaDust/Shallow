import { OrganizationLayout } from "../components/OrganizationLayout";
import { fetchOrganizationTeams } from "../lib/organization-api";
import { organizationUrl } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

/** Organization Teams: the teams of the organization and the “New team” entry. */
export function OrganizationTeamsPage({ organization }: { organization: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchOrganizationTeams(organization), [organization]);

  return (
    <OrganizationLayout
      organizationName={organization}
      organization={detail.data?.organization ?? null}
      heading="Teams"
      activeTab="teams"
      account={account}
    >
      <p className="page-hint">
        <a href={organizationUrl(organization, "teams", "new")}>New team</a>
      </p>
      {detail.loading ? <p role="status">Loading teams…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {detail.data ? (
        detail.data.teams.length > 0 ? (
          <ul className="team-list">
            {detail.data.teams.map((team) => (
              <li key={team.name} className="team-list__item">
                <a href={organizationUrl(organization, "teams", team.name)}>{team.name}</a>
                <span className="team-list__parent">
                  {team.parentTeamName ? `Parent team: ${team.parentTeamName}` : "No parent team"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>This organization has no teams.</p>
        )
      ) : null}
    </OrganizationLayout>
  );
}
