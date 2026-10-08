import { useMemo, useState } from "react";

import { ApiError } from "../lib/api";
import {
  addRepositoryAccess,
  fetchRepositoryAccess,
  saveRepositoryAccessRole,
  type RepositoryAccessEntry,
} from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { ErrorNote, LoadingNote } from "./ViewState";

const ROLE_OPTIONS = ["Read", "Triage", "Write", "Maintain", "Admin"].map((role) => ({
  value: role,
  label: role,
}));

interface Candidate {
  value: string;
  label: string;
  subjectType: "team" | "account";
  subjectName: string;
}

/**
 * "Manage access" section of the repository settings. The list shows one row
 * per direct grant (team or account) whose accessible name carries the subject
 * and current role, plus a row-scoped "Role" combobox and "Save" button.
 * "Add people or teams" opens the picker used to create a new grant.
 */
export function RepositoryAccess({ owner, name }: { owner: string; name: string }) {
  const access = useAsyncData(() => fetchRepositoryAccess(owner, name), [owner, name]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState("Read");
  const [adding, setAdding] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const candidates: Candidate[] = useMemo(() => {
    if (!access.data) return [];
    return [
      ...access.data.candidates.teams.map((team) => ({
        value: `team:${team.name}`,
        label: team.name,
        subjectType: "team" as const,
        subjectName: team.name,
      })),
      ...access.data.candidates.accounts.map((account) => ({
        value: `account:${account.username}`,
        label: account.username,
        subjectType: "account" as const,
        subjectName: account.username,
      })),
    ];
  }, [access.data]);

  const query = search.trim().toLowerCase();
  const filtered = query ? candidates.filter((candidate) => candidate.label.toLowerCase().includes(query)) : candidates;

  const openPicker = () => {
    setSearch("");
    setSelected(null);
    setRole("Read");
    setPickerError(null);
    setPickerOpen(true);
  };

  const submitPicker = async () => {
    const candidate = candidates.find((entry) => entry.value === selected);
    if (!candidate || adding) return;
    setAdding(true);
    setPickerError(null);
    try {
      const result = await addRepositoryAccess(owner, name, {
        subjectType: candidate.subjectType,
        subjectName: candidate.subjectName,
        role,
      });
      if (result.ok) {
        setPickerOpen(false);
        access.reload();
      } else {
        setPickerError(result.fieldErrors.role ?? result.fieldErrors.subjectName ?? result.message);
      }
    } catch {
      setPickerError("Unable to add access. Please try again.");
    }
    setAdding(false);
  };

  const save = async (entry: RepositoryAccessEntry) => {
    if (savingId) return;
    const nextRole = draftRoles[entry.id] ?? entry.role;
    setSavingId(entry.id);
    setActionError(null);
    try {
      const result = await saveRepositoryAccessRole(owner, name, entry.id, nextRole);
      if (result.ok) {
        setDraftRoles((previous) => {
          const next = { ...previous };
          delete next[entry.id];
          return next;
        });
        access.reload();
      } else {
        setActionError(result.fieldErrors.role ?? result.message);
      }
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Unable to save the role. Please try again.");
    }
    setSavingId(null);
  };

  if (access.status === "loading") return <LoadingNote label="Loading access…" />;
  if (access.status === "error" && access.error) return <ErrorNote error={access.error} onRetry={access.reload} />;
  if (!access.data) return <LoadingNote label="Loading access…" />;

  return (
    <div className="repository-access">
      <div className="repository-access__header">
        <Button variant="secondary" onClick={openPicker}>
          Add people or teams
        </Button>
      </div>
      {actionError ? (
        <p className="repository-access__error" role="alert">
          {actionError}
        </p>
      ) : null}
      {access.data.access.length === 0 ? (
        <p className="repository-access__empty">No people or teams have direct access yet.</p>
      ) : (
        <table className="access-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {access.data.access.map((entry) => {
              const selectedRole = draftRoles[entry.id] ?? entry.role;
              return (
                <tr
                  key={entry.id}
                  className="access-table__row"
                  aria-label={`${entry.subjectName} ${entry.role}`}
                >
                  <td className="access-table__name">{entry.subjectName}</td>
                  <td className="access-table__role">{entry.role}</td>
                  <td className="access-table__controls">
                    <Combobox
                      label="Role"
                      options={ROLE_OPTIONS}
                      value={selectedRole}
                      disabled={savingId === entry.id}
                      onChange={(event) =>
                        setDraftRoles((previous) => ({ ...previous, [entry.id]: event.target.value }))
                      }
                    />
                    <Button
                      variant="primary"
                      disabled={savingId === entry.id}
                      onClick={() => void save(entry)}
                    >
                      Save
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pickerOpen ? (
        <Dialog
          open
          title="Add people or teams"
          onOpenChange={(next) => {
            if (!next) {
              setPickerOpen(false);
              setPickerError(null);
            }
          }}
          actions={
            <>
              <Button variant="primary" disabled={adding || !selected} onClick={() => void submitPicker()}>
                Add
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPickerOpen(false);
                  setPickerError(null);
                }}
              >
                Cancel
              </Button>
            </>
          }
        >
          <FormField id="access-search" label="Search">
            <input
              id="access-search"
              name="search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </FormField>
          <div className="access-picker__options" role="listbox" aria-label="People and teams">
            {filtered.map((candidate) => (
              <button
                key={candidate.value}
                type="button"
                role="option"
                className="access-picker__option"
                aria-selected={candidate.value === selected}
                onClick={() => setSelected(candidate.value)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
          <Combobox
            id="access-grant-role"
            label="Role"
            options={ROLE_OPTIONS}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
          {pickerError ? (
            <p className="repository-access__error" role="alert">
              {pickerError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
