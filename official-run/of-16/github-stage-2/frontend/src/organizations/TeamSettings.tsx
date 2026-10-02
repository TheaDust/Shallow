import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { Button, Combobox, type ComboboxOption } from "../ui";
import { saveTeamParent } from "./api";
import type { OrganizationTeam } from "./types";

export interface TeamSettingsProps {
  slug: string;
  teamName: string;
  /** Name of the parent team currently stored for this team, or "". */
  savedParentName: string;
  /** Every team of the organization; the team itself is not a candidate. */
  teams: OrganizationTeam[];
  /** Only an organization Owner may change the hierarchy. */
  canManage: boolean;
}

const SAVE_ERROR = "We could not save the parent team. Try again.";

/**
 * Settings section of a team page. "Save" persists the selected hierarchy
 * entry; a parent that would make the team its own ancestor is rejected with
 * the exact reason and the previously saved parent stays selected.
 */
export function TeamSettings({ slug, teamName, savedParentName, teams, canManage }: TeamSettingsProps) {
  const [parentName, setParentName] = useState(savedParentName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setParentName(savedParentName);
  }, [savedParentName]);

  const options: ComboboxOption[] = [
    { value: "", label: "No parent team" },
    ...teams
      .filter((team) => team.name !== teamName)
      .map((team) => ({ value: team.name, label: team.name })),
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveTeamParent(slug, teamName, parentName);
      setSaved(true);
    } catch (failure) {
      const errors = fieldErrorsOf(failure);
      setError(errors?.parentTeam ?? errorMessageOf(failure) ?? SAVE_ERROR);
      // A rejected change never replaces the stored parent.
      setParentName(savedParentName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-settings">
      {canManage ? (
        <form className="app-form" noValidate onSubmit={handleSubmit}>
          <Combobox
            id="team-parent-team"
            label="Parent team"
            options={options}
            value={parentName}
            onChange={(event) => setParentName(event.target.value)}
          />
          {error ? (
            <p className="app-form__error" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? <p className="app-form__success" role="status">Parent team saved.</p> : null}
          <div className="app-form__actions">
            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <p className="page__lead">Only an organization Owner can change the team hierarchy.</p>
      )}
    </div>
  );
}
