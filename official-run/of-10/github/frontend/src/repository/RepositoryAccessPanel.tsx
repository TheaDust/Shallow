import { useMemo, useState } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  REPOSITORY_ROLE_OPTIONS,
  saveRepositoryAccess,
  type RepositoryAccessGrant,
  type RepositoryAccessPayload,
  type RepositoryAccessSubject,
} from "../lib/repository-access-api";
import type { RepositoryRole } from "../lib/repositories-api";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { ListboxCombobox } from "../ui/ListboxCombobox";

export interface RepositoryAccessPanelProps {
  owner: string;
  name: string;
  access: RepositoryAccessPayload;
  onChanged(): void;
}

interface SubjectPickerProps {
  access: RepositoryAccessPayload;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onSubmit(subject: RepositoryAccessSubject, role: RepositoryRole): void;
}

function subjectKey(subject: RepositoryAccessSubject): string {
  return `${subject.type}:${subject.id}`;
}

/**
 * Picker of one authorization subject (REQ-2-3). The matching members and teams
 * update while the administrator types; pressing Enter or activating a separate
 * search button is not needed before choosing an option, and the option carries
 * the subject name ("frontend-team", "bob-reviewer") so it can be recognized.
 */
function SubjectPicker({ access, busy, error, onCancel, onSubmit }: SubjectPickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RepositoryAccessSubject | null>(null);
  const [role, setRole] = useState<RepositoryRole>("write");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const candidates = access.candidates;
    if (!needle) return candidates.slice(0, 10);
    return candidates.filter((candidate) => candidate.name.toLowerCase().includes(needle)).slice(0, 10);
  }, [access.candidates, query]);

  return (
    <form
      className="repository-access__picker"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) onSubmit(selected, role);
      }}
    >
      <FormField id="repository-access-search" label="Search" error={error ?? undefined}>
        <input
          id="repository-access-search"
          type="text"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // The options already match the typed text; Enter must not submit the
            // picker before an option is chosen.
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </FormField>
      <ul className="repository-access__options" role="listbox" aria-label="Search results">
        {matches.map((candidate) => (
          <li
            key={subjectKey(candidate)}
            role="option"
            aria-label={candidate.name}
            aria-selected={selected !== null && subjectKey(selected) === subjectKey(candidate)}
          >
            <button
              type="button"
              className="repository-access__option"
              aria-pressed={selected !== null && subjectKey(selected) === subjectKey(candidate)}
              onClick={() => setSelected(candidate)}
            >
              {candidate.name}
            </button>
            <span className="repository-access__option-type">
              {candidate.type === "team" ? "Team" : "Account"}
            </span>
          </li>
        ))}
        {matches.length === 0 ? <li className="repository-access__empty">No matches</li> : null}
      </ul>
      <FormField id="repository-access-role" label="Role">
        <ListboxCombobox
          id="repository-access-role"
          label="Role"
          value={role}
          onChange={(next) => setRole(next as RepositoryRole)}
          options={REPOSITORY_ROLE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </FormField>
      <div className="repository-access__actions">
        <Button type="submit" variant="primary" disabled={busy || !selected}>
          Add
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface GrantRowProps {
  owner: string;
  name: string;
  grant: RepositoryAccessGrant;
  onChanged(): void;
}

/** One existing grant: the subject name, its stored role and the "Save" action. */
function GrantRow({ owner, name, grant, onChanged }: GrantRowProps) {
  const [role, setRole] = useState<RepositoryRole>(grant.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <tr>
      <td className="repository-access__subject">{grant.name}</td>
      <td className="repository-access__subject-type">
        {grant.subjectType === "team" ? "Team" : "Account"}
      </td>
      <td>
        <select
          aria-label="Role"
          className="repository-access__role"
          value={role}
          onChange={(event) => setRole(event.target.value as RepositoryRole)}
        >
          {REPOSITORY_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await saveRepositoryAccess(owner, name, {
                subjectType: grant.subjectType,
                subjectId: grant.subjectId,
                role,
              });
              onChanged();
            } catch (failure) {
              setError(apiErrorMessage(failure, "The role could not be saved."));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
        {error ? (
          <p role="alert" className="repository-access__error">
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * "Manage access" of one repository (REQ-2-3). The "Add people or teams" button
 * opens the picker in place; while the picker is active it owns the view — the
 * opening button and the existing grant rows are not rendered, so the textbox,
 * the role combobox and the submit action of the current step are unambiguous.
 * Every saved role is reflected in the list below, which is read back from the
 * server.
 */
export function RepositoryAccessPanel({ owner, name, access, onChanged }: RepositoryAccessPanelProps) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (subject: RepositoryAccessSubject, role: RepositoryRole) => {
    setBusy(true);
    setError(null);
    try {
      await saveRepositoryAccess(owner, name, {
        subjectType: subject.type,
        subjectId: subject.id,
        role,
      });
      setPicking(false);
      onChanged();
    } catch (failure) {
      const fields = readErrorFields(failure);
      setError(fields.subject ?? fields.role ?? apiErrorMessage(failure, "The role could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="repository-access" aria-labelledby="repository-access-heading">
      <h2 id="repository-access-heading">Manage access</h2>
      {picking ? (
        <SubjectPicker
          access={access}
          busy={busy}
          error={error}
          onCancel={() => {
            setPicking(false);
            setError(null);
          }}
          onSubmit={save}
        />
      ) : (
        <>
          <p>
            <Button variant="primary" onClick={() => setPicking(true)}>
              Add people or teams
            </Button>
          </p>
          {access.grants.length === 0 ? (
            <p className="repository-access__none">This repository has no direct access grants.</p>
          ) : (
            <table className="repository-access__table">
              <caption>Direct access grants</caption>
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Type</th>
                  <th scope="col">Role</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {access.grants.map((grant) => (
                  <GrantRow
                    key={`${grant.subjectType}:${grant.subjectId}`}
                    owner={owner}
                    name={name}
                    grant={grant}
                    onChanged={onChanged}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <p className="repository-access__hint">
        A role is granted to one account or team at a time; the highest role of an account’s own
        grants and of the teams it directly belongs to applies.
      </p>
    </section>
  );
}
