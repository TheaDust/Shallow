import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { saveRepositoryGrant } from "../../org/org-api";
import { REPOSITORY_ROLE_OPTIONS, matchesAccessSubject } from "../../org/repository-access";
import type { AccessSubject, RepositoryRole } from "../../org/types";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

interface Candidate extends AccessSubject {
  type: "account" | "team";
}

export interface AccessSubjectPickerProps {
  ownerName: string;
  repositoryName: string;
  members: readonly AccessSubject[];
  teams: readonly AccessSubject[];
  onSaved(): void;
}

/**
 * REQ-2-3: the access-subject picker opened by “Add people or teams”. While it is
 * active the opening button is hidden. It offers the “Search” textbox, the
 * matching member/team options in a listbox, the “Role” combobox (Read, Triage,
 * Write, Maintain, Admin) and the submitting “Add” button.
 */
export function AccessSubjectPicker({
  ownerName,
  repositoryName,
  members,
  teams,
  onSaved,
}: AccessSubjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [role, setRole] = useState<RepositoryRole>("write");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const candidates: Candidate[] = [
    ...teams.map((team) => ({ ...team, type: "team" as const })),
    ...members.map((member) => ({ ...member, type: "account" as const })),
  ]
    .filter((candidate) => matchesAccessSubject(candidate, query))
    .sort((left, right) => left.name.localeCompare(right.name));

  const close = () => {
    setOpen(false);
    setQuery("");
    setSelected(null);
    setRole("write");
    setError(null);
  };

  const moveFocus = (from: number, delta: number) => {
    if (candidates.length === 0) return;
    const next = (from + delta + candidates.length) % candidates.length;
    optionRefs.current[next]?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!selected) {
      setError("Select a person or team.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await saveRepositoryGrant(ownerName, repositoryName, {
        subjectType: selected.type,
        subjectId: selected.id,
        role,
      });
      if (result.ok) {
        close();
        onSaved();
        return;
      }
      setError(result.errors.role ?? result.errors.subject ?? "Unable to save the access.");
    } catch {
      setError("Unable to save the access. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <p className="manage-access__actions">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Add people or teams
        </Button>
      </p>
    );
  }

  return (
    <form className="auth-form manage-access__picker" onSubmit={submit} noValidate>
      <FormField id="access-search" label="Search">
        <input
          id="access-search"
          name="search"
          type="text"
          placeholder="Search"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        />
      </FormField>
      <div
        role="listbox"
        aria-label="Matching people and teams"
        className="manage-access__options"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const current = optionRefs.current.findIndex((node) => node === document.activeElement);
          moveFocus(current < 0 ? (event.key === "ArrowDown" ? -1 : 0) : current, event.key === "ArrowDown" ? 1 : -1);
        }}
      >
        {candidates.map((candidate, index) => (
          <button
            key={`${candidate.type}-${candidate.id}`}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            role="option"
            aria-selected={selected?.type === candidate.type && selected?.id === candidate.id}
            className="manage-access__option"
            disabled={busy}
            onClick={() => setSelected(candidate)}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      {candidates.length === 0 ? <p>No matching people or teams.</p> : null}
      <FormField id="access-role" label="Role">
        <select
          id="access-role"
          name="role"
          value={role}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setRole(event.target.value as RepositoryRole)
          }
        >
          {REPOSITORY_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>
      {error ? (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Add
        </Button>
        <Button disabled={busy} onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
