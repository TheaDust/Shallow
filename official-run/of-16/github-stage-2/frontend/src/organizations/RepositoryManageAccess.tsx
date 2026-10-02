import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { ApiError } from "../lib/api";
import { Button, Combobox, Dialog, FormField, type ComboboxOption } from "../ui";
import { addRepositoryTeamAccess, fetchRepositoryAccess, saveRepositoryAccessRole } from "./api";
import { repositoryRoleFromLabel, repositoryRoleLabel } from "./format";
import type {
  RepositoryAccessGrant,
  RepositoryAccessOverview,
  RepositoryRole,
} from "./types";

export interface RepositoryManageAccessProps {
  slug: string;
  name: string;
}

// Option values are the visible labels ("Write", "Read", ...) so the "Role"
// combobox exposes the exact requirement wording; the stored role value is
// mapped back at the request boundary.
const ROLE_OPTIONS: ComboboxOption[] = [
  { value: "Read", label: "Read" },
  { value: "Triage", label: "Triage" },
  { value: "Write", label: "Write" },
  { value: "Maintain", label: "Maintain" },
  { value: "Admin", label: "Admin" },
];

const LOAD_ERROR = "We could not load the access list. Try again.";
const ADD_ERROR = "We could not add the access. Try again.";
const SAVE_ERROR = "We could not save the role. Try again.";

type LoadFailure = "denied" | "failed";

/**
 * "Manage access" section of a repository Settings page. The list is the stored
 * access state: every row is one team or account with its repository role, a
 * "Role" combobox and a "Save" button. "Add people or teams" opens the picker
 * (a "Search" textbox, the organization's teams, a "Role" combobox and "Add").
 * Adding a team that already holds a grant updates that record, so a role
 * change never leaves a duplicate row.
 */
export function RepositoryManageAccess({ slug, name }: RepositoryManageAccessProps) {
  const [access, setAccess] = useState<RepositoryAccessOverview | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [newRole, setNewRole] = useState<RepositoryRole>("read");
  const [drafts, setDrafts] = useState<Record<string, RepositoryRole>>({});
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    setFailure(null);
    setPickerOpen(false);
    setDrafts({});
    fetchRepositoryAccess(slug, name)
      .then((next) => {
        if (!cancelled) setAccess(next);
      })
      .catch((error) => {
        if (cancelled) return;
        setFailure(error instanceof ApiError && error.status === 403 ? "denied" : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [slug, name]);

  function openPicker() {
    setSearch("");
    setSelectedTeam("");
    setNewRole("read");
    setPickerError(null);
    setPickerOpen(true);
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!selectedTeam) {
      setPickerError("Select a team to add.");
      return;
    }
    setBusy(true);
    setPickerError(null);
    try {
      const grants = await addRepositoryTeamAccess(slug, name, selectedTeam, newRole);
      setAccess((current) => (current ? { ...current, grants } : current));
      setPickerOpen(false);
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setPickerError(errors?.teamName ?? errorMessageOf(error) ?? ADD_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(grant: RepositoryAccessGrant) {
    if (busy) return;
    const role = drafts[grant.id] ?? grant.role;
    setBusy(true);
    setRowError(null);
    setSavedId(null);
    try {
      const grants = await saveRepositoryAccessRole(slug, name, grant.id, role);
      setAccess((current) => (current ? { ...current, grants } : current));
      setDrafts((current) => {
        const next = { ...current };
        delete next[grant.id];
        return next;
      });
      setSavedId(grant.id);
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setRowError(errors?.role ?? errorMessageOf(error) ?? SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (failure === "denied") {
    return (
      <p className="page__lead">
        <span role="alert">Access denied</span>
      </p>
    );
  }
  if (failure === "failed") {
    return <p role="alert">{LOAD_ERROR}</p>;
  }
  if (!access) return <p role="status">Loading access…</p>;

  const needle = search.trim().toLowerCase();
  const teamOptions = access.teams.filter((team) => (
    needle.length === 0 || team.name.toLowerCase().includes(needle)
  ));

  return (
    <div className="repository-access">
      <div className="app-form__actions">
        <Button variant="primary" onClick={openPicker}>
          Add people or teams
        </Button>
      </div>
      {rowError ? (
        <p className="app-form__error" role="alert">
          {rowError}
        </p>
      ) : null}
      {access.grants.length === 0 ? (
        <p className="repository-access__empty">This repository has no direct access grants yet.</p>
      ) : (
        <table className="access-table">
          <thead>
            <tr>
              <th scope="col">Team or person</th>
              <th scope="col">Role</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {access.grants.map((grant) => (
              <tr key={grant.id} className="access-table__row" aria-label={grant.name}>
                <td className="access-table__name">{grant.name}</td>
                <td className="access-table__role">
                  <Combobox
                    label="Role"
                    options={ROLE_OPTIONS}
                    value={repositoryRoleLabel(drafts[grant.id] ?? grant.role)}
                    onChange={(event) => {
                      const role = repositoryRoleFromLabel(event.target.value) as RepositoryRole;
                      setSavedId(null);
                      setDrafts((current) => ({ ...current, [grant.id]: role }));
                    }}
                  />
                </td>
                <td className="access-table__actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => {
                      void handleSave(grant);
                    }}
                  >
                    Save
                  </Button>
                  {savedId === grant.id ? <span role="status"> Role saved.</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pickerOpen ? (
        <Dialog open title="Add people or teams" onOpenChange={(open) => { if (!open) setPickerOpen(false); }}>
          <form className="app-form" noValidate onSubmit={handleAdd}>
            <FormField id="access-picker-search" label="Search">
              <input
                id="access-picker-search"
                name="search"
                type="search"
                autoComplete="off"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>
            <div className="access-picker__teams" role="listbox" aria-label="Teams">
              {teamOptions.length === 0 ? (
                <p className="access-picker__empty">No teams match your search.</p>
              ) : (
                teamOptions.map((team) => (
                  <div
                    key={team.id}
                    role="option"
                    aria-selected={team.name === selectedTeam}
                    tabIndex={0}
                    className="access-picker__option"
                    onClick={() => setSelectedTeam(team.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTeam(team.name);
                      }
                    }}
                  >
                    {team.name}
                  </div>
                ))
              )}
            </div>
            <Combobox
              id="access-picker-role"
              label="Role"
              options={ROLE_OPTIONS}
              value={repositoryRoleLabel(newRole)}
              onChange={(event) => setNewRole(repositoryRoleFromLabel(event.target.value) as RepositoryRole)}
            />
            {pickerError ? (
              <p className="app-form__error" role="alert">
                {pickerError}
              </p>
            ) : null}
            <div className="app-form__actions">
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
                Add
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
