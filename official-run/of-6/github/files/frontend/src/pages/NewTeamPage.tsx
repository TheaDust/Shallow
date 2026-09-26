import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { apiCreateTeam, apiOrganization, apiOrganizationTeams } from '../api';
import { navigate, useRedirectTo } from '../router';
import { useSession } from '../session';
import type { CreateTeamErrors, TeamSummary } from '../types';

interface NewTeamPageProps {
  name: string;
}

/**
 * REQ-2-2-1 organization-team creation page, opened by the "New team" link on
 * the organization overview Teams tab. The form has the labeled field "Team
 * name", an optional "Description" and an optional "Parent team" select of the
 * organization's own teams, and the submit button "Create team". Only an
 * organization Owner may create teams; the server enforces this as well.
 * Field errors are displayed next to the corresponding input; on success the
 * user is redirected to the new team page.
 */
export default function NewTeamPage({ name }: NewTeamPageProps) {
  const { auth } = useSession();
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);

  const [role, setRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [teamName, setTeamName] = useState('');
  const [description, setDescription] = useState('');
  const [parentTeamName, setParentTeamName] = useState('');
  const [errors, setErrors] = useState<CreateTeamErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (needsAuth) {
      return;
    }
    let cancelled = false;
    setNotFound(false);
    setLoadError(false);
    setRole(null);
    setRoleLoaded(false);
    setTeams(null);

    apiOrganization(name).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setNotFound(true);
        setRoleLoaded(true);
        return;
      }
      setRole(result.role ?? null);
      setRoleLoaded(true);
    });
    apiOrganizationTeams(name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setTeams(result.teams);
      } else {
        setLoadError(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [needsAuth, name]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const result = await apiCreateTeam(name, { name: teamName, description, parentTeamName });
      if (result.ok) {
        navigate(`#/organizations/${encodeURIComponent(name)}/teams/${encodeURIComponent(result.team.name)}`);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (needsAuth) {
    return null;
  }

  if (notFound) {
    return (
      <div className="organization-page">
        <h1>Organization not found</h1>
        <p className="muted-text">
          No organization named “{name}” exists on this platform.
        </p>
      </div>
    );
  }

  if (!roleLoaded) {
    return <p className="loading">Loading…</p>;
  }

  if (role !== 'owner') {
    return (
      <div className="organization-page">
        <h1>Access denied</h1>
        <p className="muted-text">
          Only an organization Owner can create teams.
        </p>
      </div>
    );
  }

  return (
    <div className="new-team-page">
      <h1>New team</h1>
      {loadError ? (
        <p role="alert" className="form-error">
          The organization data could not be loaded.
        </p>
      ) : (
        <form className="new-team-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              aria-describedby={errors.name ? 'team-name-error' : undefined}
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name ? (
              <p id="team-name-error" className="field-error">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="team-description">Description</label>
            <input
              id="team-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="team-parent">Parent team</label>
            <select
              id="team-parent"
              value={parentTeamName}
              onChange={(e) => setParentTeamName(e.target.value)}
              aria-describedby={errors.parentTeam ? 'team-parent-error' : undefined}
              aria-invalid={errors.parentTeam ? true : undefined}
            >
              <option value="">No parent</option>
              {(teams ?? []).map((team) => (
                <option key={team.name} value={team.name}>
                  {team.name}
                </option>
              ))}
            </select>
            {errors.parentTeam ? (
              <p id="team-parent-error" className="field-error">
                {errors.parentTeam}
              </p>
            ) : null}
          </div>

          <button type="submit" className="primary-button" disabled={submitting}>
            Create team
          </button>
        </form>
      )}
    </div>
  );
}
