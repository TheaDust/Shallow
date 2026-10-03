import { useEffect, useMemo, useState } from "react";

import {
  REPOSITORY_ROLE_OPTIONS,
  addRepositoryAccess,
  fetchRepositoryAccess,
  repositoryRoleLabel,
  saveRepositoryAccess,
  type AccessSubjectType,
  type RepositoryAccessGrant,
} from "../../api/organizations";
import { fieldErrorsOf, messageOf } from "../../api/auth";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button, Combobox, Dialog, FormField } from "../../ui";

interface AccessCandidate {
  key: string;
  subjectType: AccessSubjectType;
  name: string;
}

/**
 * “Manage access”: the grants stored on one repository.
 *
 * The picker behind “Add people or teams” offers the organization’s teams and
 * members as visible options; adding an already granted subject updates that
 * row instead of creating a duplicate. Each row keeps its own pending role and
 * writes it with “Save”.
 */
export function RepositoryAccessPanel({ slug, repositoryName }: { slug: string; repositoryName: string }) {
  const { data, error, loading, reload } = useAsyncData(
    () => fetchRepositoryAccess(slug, repositoryName),
    [slug, repositoryName],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AccessCandidate | null>(null);
  const [role, setRole] = useState("write");
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const access = data?.access ?? [];
  const canManage = Boolean(data) && !error;

  useEffect(() => {
    if (!data) return;
    setDrafts(Object.fromEntries(data.access.map((entry) => [entry.id, entry.role])));
  }, [data]);

  const candidates = useMemo<AccessCandidate[]>(() => {
    if (!data) return [];
    const teams = data.candidates.teams.map((name) => ({ key: `team:${name}`, subjectType: "team" as const, name }));
    const accounts = data.candidates.accounts.map((name) => ({ key: `account:${name}`, subjectType: "account" as const, name }));
    const normalized = query.trim().toLowerCase();
    return [...teams, ...accounts].filter((candidate) => (
      normalized ? candidate.name.toLowerCase().includes(normalized) : true
    ));
  }, [data, query]);

  const submitGrant = async () => {
    if (!selected) {
      setPickerError("Select a team or a person");
      return;
    }
    setPending(true);
    setPickerError(null);
    try {
      await addRepositoryAccess(slug, repositoryName, {
        subjectType: selected.subjectType,
        name: selected.name,
        role,
      });
      setSelected(null);
      setQuery("");
      setRole("write");
      setPickerOpen(false);
      reload();
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setPickerError(fields.role ?? fields.name ?? messageOf(failure, "Unable to add access"));
    } finally {
      setPending(false);
    }
  };

  const save = async (entry: RepositoryAccessGrant) => {
    setPending(true);
    setPanelError(null);
    setStatus(null);
    try {
      await saveRepositoryAccess(slug, repositoryName, entry.id, drafts[entry.id] ?? entry.role);
      reload();
      setStatus("Access saved");
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setPanelError(fields.role ?? messageOf(failure, "Unable to save access"));
      // A rejected change keeps the previously saved role selected.
      setDrafts((current) => ({ ...current, [entry.id]: entry.role }));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="repository-access">
      {/* While the picker dialog is open the rest of the panel is inert to
          assistive technology, so only the picker’s own controls are exposed. */}
      <div className="repository-access__content" aria-hidden={pickerOpen ? "true" : undefined}>
        {loading ? <p role="status">Loading…</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {panelError ? (
          <p className="form-error" role="alert">
            {panelError}
          </p>
        ) : null}
        {status ? (
          <p className="form-status" role="status">
            {status}
          </p>
        ) : null}
        {canManage ? (
          <p>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                setPickerError(null);
                setPickerOpen(true);
              }}
            >
              Add people or teams
            </Button>
          </p>
        ) : null}
        {data && !error ? (
          access.length > 0 ? (
            <table className="access-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Change role</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {access.map((entry) => (
                  <tr key={entry.id} className="access-table__row" aria-label={`${entry.subjectName} ${repositoryRoleLabel(entry.role)}`}>
                    <td className="access-table__name">{entry.subjectName}</td>
                    <td className="access-table__role">{repositoryRoleLabel(entry.role)}</td>
                    <td className="access-table__control">
                      <Combobox
                        id={`access-role-${entry.id}`}
                        label="Role"
                        options={REPOSITORY_ROLE_OPTIONS}
                        value={drafts[entry.id] ?? entry.role}
                        onChange={(event) => setDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                      />
                    </td>
                    <td className="access-table__action">
                      <Button variant="secondary" disabled={pending} onClick={() => void save(entry)}>
                        Save
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="access-list__empty">No direct access yet.</p>
          )
        ) : null}
      </div>
      {pickerOpen ? (
        <Dialog
          open
          title="Add people or teams"
          onOpenChange={(next) => {
            if (!next) setPickerOpen(false);
          }}
          actions={
            <>
              <Button variant="secondary" onClick={() => setPickerOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={pending} onClick={() => void submitGrant()}>
                Add
              </Button>
            </>
          }
        >
          <FormField id={`access-search-${repositoryName}`} label="Search">
            <input
              id={`access-search-${repositoryName}`}
              name="search"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </FormField>
          <div role="listbox" aria-label="Teams and people" className="access-picker__options">
            {candidates.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                role="option"
                aria-selected={selected?.key === candidate.key}
                className="access-picker__option"
                onClick={() => setSelected(candidate)}
              >
                {candidate.name}
              </button>
            ))}
          </div>
          {candidates.length === 0 ? <p className="access-picker__empty">No matching teams or people.</p> : null}
          <Combobox
            id={`access-picker-role-${repositoryName}`}
            label="Role"
            options={REPOSITORY_ROLE_OPTIONS}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
          {pickerError ? (
            <p className="form-error" role="alert">
              {pickerError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}
