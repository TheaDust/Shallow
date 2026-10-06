import { fetchOrganizationTeams } from "../lib/org-api";
import { teamHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { ErrorNote, LoadingNote } from "./ViewState";

/** Teams tab of the organization overview. */
export function OrganizationTeams({
  organizationId,
  viewerRole,
}: {
  organizationId: string;
  viewerRole: string | null;
}) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchOrganizationTeams(organizationId),
    [organizationId],
  );

  if (status === "loading") return <LoadingNote label="Loading teams…" />;
  if (status === "error") return error ? <ErrorNote error={error} onRetry={reload} /> : null;
  if (!data) return <LoadingNote label="Loading teams…" />;

  return (
    <div className="org-teams">
      {viewerRole === "Owner" ? (
        <p className="org-teams__actions">
          <a className="ui-button" href={`#/orgs/${encodeURIComponent(organizationId)}/teams/new`}>
            New team
          </a>
        </p>
      ) : null}
      {data.length === 0 ? (
        <p className="org-teams__empty">This organization has no teams yet.</p>
      ) : (
        <ul className="team-list" aria-label="Teams">
          {data.map((team) => (
            <li key={team.id} className="team-list__item">
              <a className="team-list__name" href={teamHash(organizationId, team.name)}>
                {team.name}
              </a>
              {team.parentName ? (
                <span className="team-list__parent">Parent team {team.parentName}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
