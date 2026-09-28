import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { navigate } from "../../lib/hash-route";
import { createTeam, fetchOrganization, listTeams, OrganizationSummary, TeamFieldErrors, TeamSummary } from "../../lib/org-api";
import { useSession } from "../../session";

/**
 * “New team” form opened from the Teams tab: Team name plus optional
 * description and parent team from the same organization.
 */
export function NewTeamPage({ orgName }: { orgName: string }) {
  const { status } = useSession();
  const [org, setOrg] = useState<OrganizationSummary | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentTeamId, setParentTeamId] = useState("");
  const [errors, setErrors] = useState<TeamFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrganization(orgName)
      .then((result) => {
        if (!cancelled) setOrg(result);
      })
      .catch(() => undefined);
    listTeams(orgName).then((result) => {
      if (!cancelled) setTeams(result);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgName]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await createTeam(orgName, {
        name,
        description,
        parentTeamId: parentTeamId === "" ? null : parentTeamId,
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      navigate(`/o/${orgName}/teams/${result.team.name}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <AppHeader>
        <main>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  const isOwner = status === "authenticated" && org?.role === "owner";

  return (
    <AppHeader>
      <main>
        <h1>New team</h1>
        {!isOwner && (
          <p>Only an organization Owner can create a team.</p>
        )}
        <form className="account-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="account-form__field">
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={errors.name ? "team-name-error" : undefined}
              autoComplete="off"
              disabled={!isOwner}
            />
            {errors.name && (
              <p className="account-form__error" id="team-name-error">
                {errors.name}
              </p>
            )}
          </div>
          <div className="account-form__field">
            <label htmlFor="team-description">Description</label>
            <input
              id="team-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!isOwner}
            />
          </div>
          <div className="account-form__field">
            <label htmlFor="team-parent">Parent team</label>
            <select
              id="team-parent"
              value={parentTeamId}
              onChange={(event) => setParentTeamId(event.target.value)}
              disabled={!isOwner}
            >
              <option value="">None</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {errors.parentTeam && (
              <p className="account-form__error" id="team-parent-error">
                {errors.parentTeam}
              </p>
            )}
          </div>
          <button type="submit" className="button button--primary" disabled={submitting || !isOwner}>
            Create team
          </button>
        </form>
      </main>
    </AppHeader>
  );
}
