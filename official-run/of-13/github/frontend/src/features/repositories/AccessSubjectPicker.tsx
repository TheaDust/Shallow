import { useId, useState, type KeyboardEvent } from "react";

import {
  REPOSITORY_ROLE_OPTIONS,
  type AccessSubjectType,
  type SaveRepositoryGrantInput,
} from "../../lib/repository-access-api";
import { Button, Combobox } from "../../ui";

export interface AccessCandidate {
  id: string;
  name: string;
  type: AccessSubjectType;
}

export interface AccessSubjectPickerProps {
  candidates: AccessCandidate[];
  busy: boolean;
  error: string | null;
  onSubmit(input: SaveRepositoryGrantInput): void;
  onCancel(): void;
}

function typeLabel(type: AccessSubjectType): string {
  return type === "team" ? "Team" : "Member";
}

function candidateKey(candidate: AccessCandidate): string {
  return `${candidate.type}:${candidate.name}`;
}

/**
 * The "Add people or teams" picker. Typing in Search filters the organization's
 * current members and teams immediately, clicking an option selects it, and the
 * Role combobox plus the Add button store exactly one direct grant.
 */
export function AccessSubjectPicker({
  candidates,
  busy,
  error,
  onSubmit,
  onCancel,
}: AccessSubjectPickerProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AccessCandidate | null>(null);
  const [role, setRole] = useState<string>("read");
  const [activeIndex, setActiveIndex] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmed = query.trim().toLowerCase();
  const matches =
    trimmed.length === 0
      ? candidates
      : candidates.filter((candidate) => candidate.name.toLowerCase().includes(trimmed));
  const safeActiveIndex = Math.min(activeIndex, Math.max(matches.length - 1, 0));

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(safeActiveIndex + 1, matches.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(safeActiveIndex - 1, 0));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(matches[safeActiveIndex]);
    }
  }

  function submit() {
    if (!selected) {
      setLocalError("Select a member or team to add.");
      return;
    }
    setLocalError(null);
    onSubmit({ subjectType: selected.type, subjectName: selected.name, role });
  }

  return (
    <section className="access-picker" aria-label="Add people or teams">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="access-picker__search">
        <label htmlFor={searchId}>Search</label>
        <input
          id={searchId}
          name="search"
          type="text"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
      </div>
      <ul
        className="access-picker__options"
        role="listbox"
        aria-label="Matching members and teams"
        tabIndex={0}
        aria-activedescendant={
          matches.length > 0 ? `access-option-${safeActiveIndex}` : undefined
        }
        onKeyDown={handleListKeyDown}
      >
        {matches.map((candidate, index) => {
          const isSelected =
            selected !== null && candidateKey(selected) === candidateKey(candidate);
          return (
            <li
              key={candidateKey(candidate)}
              id={`access-option-${index}`}
              className="access-picker__option"
              role="option"
              aria-selected={isSelected}
              onClick={() => setSelected(candidate)}
            >
              {candidate.name} ({typeLabel(candidate.type)})
            </li>
          );
        })}
      </ul>
      {matches.length === 0 ? (
        <p className="access-picker__empty" role="status">
          No matching members or teams.
        </p>
      ) : null}
      <Combobox
        id={`${searchId}-role`}
        label="Role"
        options={REPOSITORY_ROLE_OPTIONS}
        value={role}
        onChange={(event) => setRole(event.target.value)}
      />
      {localError ? (
        <p className="form-error" role="alert">
          {localError}
        </p>
      ) : null}
      <div className="access-picker__actions">
        <Button variant="primary" disabled={busy} onClick={submit}>
          Add
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
