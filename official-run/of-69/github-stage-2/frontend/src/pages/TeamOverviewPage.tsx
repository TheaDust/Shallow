import { TeamLayout } from "../components/TeamLayout";
import { fetchTeam } from "../lib/organization-api";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

/** Team overview: the team heading plus the “Members” and “Settings” entries. */
export function TeamOverviewPage({ organization, team }: { organization: string; team: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchTeam(organization, team), [organization, team]);

  return (
    <TeamLayout
      organizationName={organization}
      teamName={team}
      organizationDisplayName={detail.data?.organization.displayName}
      heading={team}
      activeSection="overview"
      account={account}
    >
      {detail.loading ? <p role="status">Loading team…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {detail.data ? (
        <p className="page-hint">
          Parent team: {detail.data.team.parentTeamName ?? "None"}. Team membership is managed on “Members”, and the
          team hierarchy on “Settings”.
        </p>
      ) : null}
    </TeamLayout>
  );
}
