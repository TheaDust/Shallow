import { fetchOrganizationTeams } from "../../api/organizations";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";

/** The “Teams” tab: teams of the organization plus the “New team” entry. */
export function TeamsPanel({ slug }: { slug: string }) {
  const { data, error, loading } = useAsyncData(() => fetchOrganizationTeams(slug), [slug]);
  const canManage = data?.organization.role === "owner";

  return (
    <section className="organization-panel">
      {canManage ? (
        <p>
          <a href={makeHash(`/organizations/${slug}/teams/new`)}>New team</a>
        </p>
      ) : null}
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !error ? (
        data.teams.length > 0 ? (
          <ul className="team-list">
            {data.teams.map((team) => (
              <li key={team.id} className="team-list__item">
                <a href={makeHash(`/organizations/${slug}/teams/${team.slug}`)}>{team.slug}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="team-list__empty">No teams yet.</p>
        )
      ) : null}
    </section>
  );
}
