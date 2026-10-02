import { useEffect, useState } from "react";

import { fetchOrganizationTeams } from "./api";

function useLoaded<T>(load: () => Promise<T>, key: string) {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setValue(null);
    setFailed(false);
    load()
      .then((next) => {
        if (!cancelled) setValue(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { value, failed };
}

export function OrganizationTeams({ slug }: { slug: string }) {
  const { value: teams, failed } = useLoaded(() => fetchOrganizationTeams(slug), slug);

  const newTeamLink = (
    <p className="page__links">
      <a href={`#/organizations/${slug}/teams/new`}>New team</a>
    </p>
  );

  if (failed) {
    return (
      <div>
        <p role="alert">We could not load the teams. Try again.</p>
      </div>
    );
  }
  if (teams === null) return <p role="status">Loading teams…</p>;

  const parentNameOf = (teamId: string | null) => teams.find((team) => team.id === teamId)?.name ?? null;
  return (
    <div className="org-teams">
      {newTeamLink}
      {teams.length === 0 ? (
        <p className="org-teams__empty">This organization has no teams yet.</p>
      ) : (
        <ul className="team-list">
          {teams.map((team) => (
            <li key={team.id} className="team-list__item">
              <a className="team-list__name" href={`#/organizations/${slug}/teams/${team.name}`}>
                {team.name}
              </a>
              {parentNameOf(team.parentTeamId) ? (
                <span className="team-list__parent">{parentNameOf(team.parentTeamId)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
