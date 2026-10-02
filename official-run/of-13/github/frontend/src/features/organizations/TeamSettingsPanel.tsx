import { useEffect, useState, type FormEvent } from "react";

import { saveTeamParent, type OrganizationTeam } from "../../lib/organizations-api";
import { fieldErrorsOf, messageOf } from "../../lib/session-api";
import { Button, FormField } from "../../ui";

export interface TeamSettingsPanelProps {
  organizationName: string;
  teamName: string;
  team: OrganizationTeam;
  parentOptions: string[];
  canManage: boolean;
  onChanged(): void;
}

/**
 * The team "Settings" tab: change the parent team. The server rejects a parent
 * outside the organization and any cyclic hierarchy, in which case the stored
 * parent stays selected.
 */
export function TeamSettingsPanel({
  organizationName,
  teamName,
  team,
  parentOptions,
  canManage,
  onChanged,
}: TeamSettingsPanelProps) {
  const storedParent = team.parent ?? "";
  const [parent, setParent] = useState(storedParent);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setParent(storedParent);
  }, [storedParent]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveTeamParent(organizationName, teamName, parent);
      setSaved(true);
      onChanged();
    } catch (failure) {
      const errors = fieldErrorsOf(failure);
      // A rejected change leaves the stored parent as the selected value.
      setParent(storedParent);
      setError(
        Object.values(errors)[0] ??
          messageOf(failure, "Unable to save the parent team right now."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="team-settings" aria-label="Settings">
      {canManage ? (
        <form className="team-settings__form" noValidate onSubmit={handleSubmit}>
          <FormField id="team-parent-team" label="Parent team" error={error ?? undefined}>
            <select
              id="team-parent-team"
              name="parent"
              value={parent}
              onChange={(event) => {
                setParent(event.target.value);
                setSaved(false);
              }}
            >
              <option value="">No parent</option>
              {parentOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
          {saved ? <p role="status">Parent team saved.</p> : null}
        </form>
      ) : (
        <p>Only an organization Owner can change the team hierarchy.</p>
      )}
    </section>
  );
}
