import { useCallback, useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { ApiError } from "../../lib/api";
import {
  addRepoGrant,
  fetchRepoGrants,
  fetchRepository,
  GrantFieldErrors,
  GrantSubjectType,
  GrantSummary,
  listOrganizationMembers,
  listTeams,
  MemberSummary,
  REPO_ROLE_OPTIONS,
  repoRoleLabel,
  RepositorySummary,
  TeamSummary,
  updateRepoGrantRole,
} from "../../lib/org-api";
import { useSession } from "../../session";

interface SubjectSelection {
  subjectType: GrantSubjectType;
  subject: string;
}

/**
 * Repository “Manage access” page. An organization Owner or repository Admin
 * grants Read/Triage/Write/Maintain/Admin roles to current organization
 * members or teams; a non-admin sees no management controls (the server
 * rejects unauthorized requests as well). Exactly one direct grant record is
 * stored per subject and repository.
 */
export function ManageAccessPage({ orgName, repoName }: { orgName: string; repoName: string }) {
  const { status } = useSession();
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [grants, setGrants] = useState<GrantSummary[] | null>(null);
  const [effectiveRole, setEffectiveRole] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SubjectSelection | null>(null);
  const [role, setRole] = useState("write");
  const [pickerErrors, setPickerErrors] = useState<GrantFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [rowRoles, setRowRoles] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string | undefined>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadGrants = useCallback(() => {
    fetchRepoGrants(orgName, repoName)
      .then(({ grants: loaded, effectiveRole: roleValue }) => {
        setGrants(loaded);
        setEffectiveRole(roleValue);
        setRowRoles({});
        setRowErrors({});
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 403) setDenied(true);
        else if (error instanceof ApiError && error.status === 404) setNotFound(true);
        else setDenied(true);
      });
  }, [orgName, repoName]);

  useEffect(() => {
    let cancelled = false;
    fetchRepository(orgName, repoName)
      .then((result) => {
        if (!cancelled) setRepository(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setDenied(true);
        else setNotFound(true);
      });
    loadGrants();
    listOrganizationMembers(orgName)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch(() => undefined);
    listTeams(orgName)
      .then((result) => {
        if (!cancelled) setTeams(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgName, repoName, loadGrants]);

  if (notFound) {
    return (
      <AppHeader>
        <main>
          <h1>{orgName}/{repoName}</h1>
          <p>Repository not found.</p>
        </main>
      </AppHeader>
    );
  }

  if (denied) {
    return (
      <AppHeader>
        <main>
          <h1>{orgName}/{repoName}</h1>
          <p>Access denied</p>
          {status !== "authenticated" && (
            <p>
              <a href="#/signin">Sign in</a>
            </p>
          )}
        </main>
      </AppHeader>
    );
  }

  if (!repository || grants === null) {
    return (
      <AppHeader>
        <main>
          <h1>{orgName}/{repoName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  const canManage = effectiveRole === "admin";

  async function handleAdd() {
    if (submitting) return;
    if (!selected) {
      setPickerErrors({ subject: "Select a person or team" });
      return;
    }
    setPickerErrors({});
    setSubmitting(true);
    try {
      const result = await addRepoGrant(orgName, repoName, { ...selected, role });
      if (!result.ok) {
        setPickerErrors(result.errors);
        return;
      }
      setPickerOpen(false);
      setSearch("");
      setSelected(null);
      setRole("write");
      await loadGrants();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveRow(subjectType: GrantSubjectType, subjectName: string) {
    const key = `${subjectType}:${subjectName}`;
    if (savingKey) return;
    setSavingKey(key);
    setRowErrors((previous) => ({ ...previous, [key]: undefined }));
    try {
      const result = await updateRepoGrantRole(orgName, repoName, subjectType, subjectName, rowRoles[key] ?? "");
      if (!result.ok) {
        setRowErrors((previous) => ({ ...previous, [key]: result.errors.role ?? "Unable to save role." }));
        return;
      }
      await loadGrants();
    } finally {
      setSavingKey(null);
    }
  }

  const searchValue = search.trim().toLowerCase();
  const options = [
    ...members.map((member): SubjectSelection & { label: string } => ({
      subjectType: "account" as const,
      subject: member.username,
      label: member.username,
    })),
    ...teams.map((team): SubjectSelection & { label: string } => ({
      subjectType: "team" as const,
      subject: team.name,
      label: team.name,
    })),
  ].filter((option) => !searchValue || option.label.toLowerCase().includes(searchValue));

  return (
    <AppHeader>
      <main>
        <h1>{orgName}/{repository.name}</h1>
        <nav className="org-tabs" aria-label="Repository">
          <a className="org-tabs__link" href={`#/o/${orgName}/repos/${encodeURIComponent(repository.name)}`}>
            Code
          </a>
          <a
            className="org-tabs__link"
            href={`#/o/${orgName}/repos/${encodeURIComponent(repository.name)}/settings`}
            aria-current="page"
          >
            Settings
          </a>
        </nav>
        <section aria-label="Manage access">
          <h2>Manage access</h2>
          {!canManage ? (
            <p>You need repository Admin permission to manage access.</p>
          ) : (
            <>
              {!pickerOpen && (
                <p>
                  <button type="button" className="button" onClick={() => setPickerOpen(true)}>
                    Add people or teams
                  </button>
                </p>
              )}
              {pickerOpen && (
                <div className="access-picker">
                  <div className="account-form__field">
                    <label htmlFor="access-search">Search</label>
                    <input
                      id="access-search"
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <ul role="listbox" aria-label="People or teams" className="access-picker__options">
                    {options.map((option) => {
                      const key = `${option.subjectType}:${option.subject}`;
                      const isSelected = selected !== null && selected.subjectType === option.subjectType && selected.subject === option.subject;
                      return (
                        <li
                          key={key}
                          role="option"
                          aria-selected={isSelected}
                          className={isSelected ? "access-picker__option access-picker__option--selected" : "access-picker__option"}
                          onClick={() => setSelected({ subjectType: option.subjectType, subject: option.subject })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelected({ subjectType: option.subjectType, subject: option.subject });
                            }
                          }}
                          tabIndex={0}
                        >
                          {option.label}
                        </li>
                      );
                    })}
                    {options.length === 0 && <li className="access-picker__option access-picker__option--empty">No matching people or teams.</li>}
                  </ul>
                  {pickerErrors.subject && <p className="account-form__error">{pickerErrors.subject}</p>}
                  <div className="account-form__field">
                    <label htmlFor="access-role">Role</label>
                    <select id="access-role" value={role} onChange={(event) => setRole(event.target.value)}>
                      {REPO_ROLE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {repoRoleLabel(option)}
                        </option>
                      ))}
                    </select>
                    {pickerErrors.role && <p className="account-form__error">{pickerErrors.role}</p>}
                  </div>
                  <button type="button" className="button button--primary" onClick={() => void handleAdd()} disabled={submitting}>
                    Add
                  </button>
                </div>
              )}
              <h3>Authorized people and teams</h3>
              {grants.length === 0 ? (
                <p>No access grants yet.</p>
              ) : (
                <table className="grants-table">
                  <thead>
                    <tr>
                      <th scope="col">Subject</th>
                      <th scope="col">Role</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((grant) => {
                      const key = `${grant.subjectType}:${grant.subjectName}`;
                      const roleValue = rowRoles[key] ?? grant.role;
                      return (
                        <tr key={key} aria-label={grant.subjectName}>
                          <td>{grant.subjectName}</td>
                          <td>
                            <label className="visually-hidden" htmlFor={`grant-role-${key}`}>
                              Role
                            </label>
                            <select
                              id={`grant-role-${key}`}
                              value={roleValue}
                              onChange={(event) =>
                                setRowRoles((previous) => ({ ...previous, [key]: event.target.value }))
                              }
                              disabled={savingKey === key}
                            >
                              {REPO_ROLE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {repoRoleLabel(option)}
                                </option>
                              ))}
                            </select>
                            {rowErrors[key] && <p className="account-form__error">{rowErrors[key]}</p>}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="button"
                              onClick={() => void handleSaveRow(grant.subjectType, grant.subjectName)}
                              disabled={savingKey === key}
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
        </section>
      </main>
    </AppHeader>
  );
}
