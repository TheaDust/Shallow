import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  apiGrantRepoAccess,
  apiOrganizationPeople,
  apiOrganizationTeams,
  apiRepoAccess,
  apiRepository,
  apiUpdateRepoAccess,
} from '../api';
import { useSession } from '../session';
import type {
  GrantRepoAccessResult,
  OrganizationMember,
  RepoAccessErrors,
  RepoAccessGrant,
  RepoRole,
  RepositoryOverview,
  TeamSummary,
} from '../types';

interface ManageAccessPageProps {
  owner: string;
  name: string;
}

const REPO_ROLE_OPTIONS: RepoRole[] = ['read', 'triage', 'write', 'maintain', 'admin'];

function grantKey(subjectType: 'user' | 'team', subjectName: string): string {
  return `${subjectType}:${subjectName}`;
}

function roleLabel(role: RepoRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * REQ-2-3 repository "Manage access" page. Lists every direct role grant as a
 * row whose accessible name includes the subject name; each row carries a
 * native select labeled "Role" and a "Save" button (saving replaces the
 * stored role, keeping exactly one record per subject). The "Add people or
 * teams" button opens a picker with a "Search" textbox that filters the
 * selectable member/team options as the administrator types, a "Role"
 * combobox (Read/Triage/Write/Maintain/Admin) and an "Add" button; while the
 * picker is open the opening button is hidden so the submit action is
 * unambiguous. Only an organization Owner or repository Admin can manage
 * access; the server enforces this on every endpoint.
 */
export default function ManageAccessPage({ owner, name }: ManageAccessPageProps) {
  const { auth } = useSession();
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [grants, setGrants] = useState<RepoAccessGrant[] | null>(null);
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerRole, setPickerRole] = useState<RepoRole>('write');
  const [addErrors, setAddErrors] = useState<RepoAccessErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Grant row state
  const [rowRoles, setRowRoles] = useState<Record<string, RepoRole>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function applyGrants(next: RepoAccessGrant[]) {
    setGrants(next);
    const roles: Record<string, RepoRole> = {};
    for (const grant of next) {
      roles[grantKey(grant.subjectType, grant.subjectName)] = grant.role;
    }
    setRowRoles(roles);
  }

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setGrants(null);
    setMembers(null);
    setTeams(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    setPickerOpen(false);
    setSearch('');
    setSelected(null);
    setAddErrors({});
    setRowError(null);

    apiRepository(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRepository(result.repository);
        if (result.repository.ownerType === 'organization') {
          apiOrganizationPeople(owner).then((peopleResult) => {
            if (!cancelled && peopleResult.ok) {
              setMembers(peopleResult.members);
            }
          });
          apiOrganizationTeams(owner).then((teamsResult) => {
            if (!cancelled && teamsResult.ok) {
              setTeams(teamsResult.teams);
            }
          });
        }
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });

    apiRepoAccess(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        applyGrants(result.grants);
      } else if (result.status === 403) {
        setDenied(true);
      } else if (result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, name]);

  const visibleMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members ?? []).filter(
      (member) => q === '' || member.username.toLowerCase().includes(q)
    );
  }, [members, search]);

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams ?? []).filter(
      (team) => q === '' || team.name.toLowerCase().includes(q)
    );
  }, [teams, search]);

  if (denied || (repository !== null && repository.role !== 'admin')) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to manage access for this repository.
        </p>
        {auth.status === 'ready' && !auth.user ? (
          <a className="primary-link" href="#/signin">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Repository not found</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  if (repository === null || grants === null) {
    return (
      <div className="repository-page">
        <p className="loading">Loading…</p>
      </div>
    );
  }

  const settingsHref = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/settings`;

  async function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null || submitting) {
      return;
    }
    setSubmitting(true);
    setAddErrors({});
    const separator = selected.indexOf(':');
    const subjectType = selected.slice(0, separator) as 'user' | 'team';
    const subjectName = selected.slice(separator + 1);
    try {
      const result: GrantRepoAccessResult = await apiGrantRepoAccess(owner, name, {
        subjectType,
        subjectName,
        role: pickerRole,
      });
      if (result.ok) {
        applyGrants(result.grants);
        setPickerOpen(false);
        setSelected(null);
        setSearch('');
        setPickerRole('write');
      } else {
        setAddErrors(result.errors);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRowSave(grant: RepoAccessGrant) {
    const key = grantKey(grant.subjectType, grant.subjectName);
    const role = rowRoles[key] ?? grant.role;
    if (role === grant.role || savingKey !== null) {
      return;
    }
    setSavingKey(key);
    setRowError(null);
    const result = await apiUpdateRepoAccess(
      owner,
      name,
      grant.subjectType,
      grant.subjectName,
      role
    );
    if (result.ok) {
      applyGrants(result.grants);
    } else {
      setRowError(result.message ?? 'The role could not be updated.');
      // A rejected save keeps the stored role selected.
      applyGrants(grants ?? []);
    }
    setSavingKey(null);
  }

  return (
    <div className="repository-page manage-access-page">
      <h1>Manage access</h1>
      <p className="repository-settings-title">
        {repository.owner}/{repository.name}
      </p>
      <nav className="settings-nav" aria-label="Repository settings">
        <a className="settings-nav-link" href={settingsHref}>
          Settings
        </a>
      </nav>

      {loadError ? (
        <p role="alert" className="form-error">
          The access data could not be loaded.
        </p>
      ) : (
        <>
          <div className="repo-access-section">
            {pickerOpen ? (
              <form className="repo-access-picker" onSubmit={handleAddSubmit} noValidate>
                <div className="field">
                  <label htmlFor="repo-access-search">Search</label>
                  <input
                    id="repo-access-search"
                    type="text"
                    value={search}
                    autoFocus
                    onChange={(e) => setSearch(e.target.value)}
                    aria-describedby={
                      addErrors.subjectName ? 'repo-access-subject-error' : undefined
                    }
                    aria-invalid={addErrors.subjectName ? true : undefined}
                  />
                  {addErrors.subjectName ? (
                    <p id="repo-access-subject-error" className="field-error">
                      {addErrors.subjectName}
                    </p>
                  ) : null}
                  {addErrors.subjectType ? (
                    <p className="field-error">{addErrors.subjectType}</p>
                  ) : null}
                </div>
                <div className="access-subject-groups">
                  {visibleMembers.length > 0 ? (
                    <div className="access-subject-group">
                      <p className="access-subject-group-label">Members</p>
                      {visibleMembers.map((member) => (
                        <label key={member.username} className="access-subject-option">
                          <input
                            type="radio"
                            name="access-subject"
                            value={`user:${member.username}`}
                            checked={selected === `user:${member.username}`}
                            onChange={() => setSelected(`user:${member.username}`)}
                          />
                          {member.username}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {visibleTeams.length > 0 ? (
                    <div className="access-subject-group">
                      <p className="access-subject-group-label">Teams</p>
                      {visibleTeams.map((team) => (
                        <label key={team.name} className="access-subject-option">
                          <input
                            type="radio"
                            name="access-subject"
                            value={`team:${team.name}`}
                            checked={selected === `team:${team.name}`}
                            onChange={() => setSelected(`team:${team.name}`)}
                          />
                          {team.name}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {visibleMembers.length === 0 && visibleTeams.length === 0 ? (
                    <p className="muted-text">No matching people or teams.</p>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="repo-access-role">Role</label>
                  <select
                    id="repo-access-role"
                    value={pickerRole}
                    onChange={(e) => setPickerRole(e.target.value as RepoRole)}
                    aria-describedby={
                      addErrors.role ? 'repo-access-role-error' : undefined
                    }
                    aria-invalid={addErrors.role ? true : undefined}
                  >
                    {REPO_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  {addErrors.role ? (
                    <p id="repo-access-role-error" className="field-error">
                      {addErrors.role}
                    </p>
                  ) : null}
                </div>
                <div className="add-member-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={submitting || selected === null}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setPickerOpen(false);
                      setSelected(null);
                      setSearch('');
                      setAddErrors({});
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setSearch('');
                  setSelected(null);
                  setAddErrors({});
                  setPickerOpen(true);
                }}
              >
                Add people or teams
              </button>
            )}
          </div>

          {rowError ? (
            <p role="alert" className="form-error">
              {rowError}
            </p>
          ) : null}

          {grants.length === 0 ? (
            <p className="muted-text">No people or teams have access yet.</p>
          ) : (
            <table className="repo-access-table">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Role</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => {
                  const key = grantKey(grant.subjectType, grant.subjectName);
                  return (
                    <tr key={key} className="repo-access-row">
                      <td>
                        <span className="grant-subject-name">{grant.subjectName}</span>
                        <span className="grant-subject-type">
                          {grant.subjectType === 'team' ? 'Team' : 'Member'}
                        </span>
                      </td>
                      <td>
                        <div className="grant-role-field">
                          <label htmlFor={`grant-role-${key}`}>Role</label>
                          <select
                            id={`grant-role-${key}`}
                            value={rowRoles[key] ?? grant.role}
                            onChange={(e) =>
                              setRowRoles((prev) => ({
                                ...prev,
                                [key]: e.target.value as RepoRole,
                              }))
                            }
                          >
                            {REPO_ROLE_OPTIONS.map((role) => (
                              <option key={role} value={role}>
                                {roleLabel(role)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button grant-save-button"
                          disabled={savingKey !== null}
                          onClick={() => void handleRowSave(grant)}
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
