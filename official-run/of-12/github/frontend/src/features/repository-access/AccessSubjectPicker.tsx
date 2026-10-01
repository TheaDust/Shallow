import { useMemo, useState, type FormEvent } from "react";

import { Button, FormField, OptionCombobox } from "../../ui";
import {
  filterCandidates,
  subjectKey,
  type AccessSubject,
  type RepositoryAccessDetail,
} from "./access-api";

export interface AccessSubjectPickerProps {
  candidates: readonly AccessSubject[];
  roles: readonly string[];
  /** Performs the save; the server validates the role and the subject. */
  onSave(input: { subjectType: string; subject: string; role: string }): Promise<
    { ok: true; data: RepositoryAccessDetail } | { ok: false; errors: Record<string, string>; message: string }
  >;
  onClose(): void;
}

/**
 * "Add people or teams" picker of the Manage-access page (REQ-2-3).
 *
 * The visible (matched) members and teams update while the administrator types
 * in the "Search" textbox — no Enter press or separate search button — and an
 * option can be selected right away. The selected subject plus the "Role"
 * combobox are committed with "Add", which stores one direct grant per
 * subject. While this picker is open the opening button is not rendered, so
 * the submit action is unambiguous.
 */
export function AccessSubjectPicker({ candidates, roles, onSave, onClose }: AccessSubjectPickerProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AccessSubject | null>(null);
  const [role, setRole] = useState<string>(roles[0] ?? "Read");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const matching = useMemo(() => filterCandidates(candidates, search), [candidates, search]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) {
      setErrors({ subject: "Select a member or team" });
      setMessage("");
      return;
    }
    setBusy(true);
    setErrors({});
    setMessage("");
    const result = await onSave({
      subjectType: selected.subjectType,
      subject: selected.name,
      role,
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(Object.keys(result.errors).length > 0 ? "" : result.message);
      return;
    }
    onClose();
  };

  return (
    <form className="access-picker" aria-label="Add people or teams" onSubmit={submit} noValidate>
      <FormField id="access-subject-search" label="Search">
        <input
          id="access-subject-search"
          name="search"
          type="text"
          placeholder="Search members and teams"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </FormField>

      <div className="access-picker__subjects">
        <p className="access-picker__heading" id="access-subject-label">Members and teams</p>
        <div
          className="access-picker__options"
          role="listbox"
          aria-labelledby="access-subject-label"
        >
          {matching.map((candidate) => {
            const isSelected = selected !== null && subjectKey(selected) === subjectKey(candidate);
            return (
              <button
                key={subjectKey(candidate)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="access-picker__option"
                data-type={candidate.subjectType}
                onClick={() => setSelected(isSelected ? null : candidate)}
              >
                {candidate.name}
                <span aria-hidden="true" className="access-picker__option-type">
                  {candidate.subjectType === "team" ? "Team" : "Member"}
                </span>
              </button>
            );
          })}
        </div>
        {matching.length === 0 ? (
          <p className="access-picker__empty">No members or teams matched your search.</p>
        ) : null}
        {errors.subject ? (
          <p className="access-picker__error" role="alert">{errors.subject}</p>
        ) : null}
      </div>

      <OptionCombobox
        id="access-subject-role"
        label="Role"
        value={role}
        options={roles}
        onChange={setRole}
        error={errors.role}
      />

      {message ? <p className="access-picker__error" role="alert">{message}</p> : null}

      <div className="access-picker__actions">
        <Button type="submit" variant="primary" disabled={busy}>Add</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}
