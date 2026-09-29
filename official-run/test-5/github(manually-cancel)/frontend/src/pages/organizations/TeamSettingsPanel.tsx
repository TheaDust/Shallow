import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { saveTeamParent } from "../../org/org-api";
import type { TeamDetail, TeamSummary } from "../../org/types";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

export interface TeamSettingsPanelProps {
  organizationName: string;
  team: TeamDetail;
  teams: readonly TeamSummary[];
  /** Only an organization Owner may change the team hierarchy. */
  canManage: boolean;
  onChanged(): void;
}

/**
 * REQ-2-2-2: the Settings view holds the native “Parent team” select (its option
 * labels are team names) and “Save”. A rejected change — including a cyclic
 * relationship — is reported and the stored parent stays selected.
 */
export function TeamSettingsPanel({
  organizationName,
  team,
  teams,
  canManage,
  onChanged,
}: TeamSettingsPanelProps) {
  const storedParentId = team.parentTeamId ?? "";
  const [parentTeamId, setParentTeamId] = useState(storedParentId);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setParentTeamId(team.parentTeamId ?? "");
  }, [team.id, team.parentTeamId]);

  const options = teams
    .filter((candidate) => candidate.id !== team.id)
    .sort((left, right) => left.name.localeCompare(right.name));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveTeamParent(organizationName, team.name, parentTeamId || null);
      if (result.ok) {
        setSaved(true);
        onChanged();
        return;
      }
      setError(result.errors.parentTeamId ?? "Unable to save the parent team.");
      setParentTeamId(team.parentTeamId ?? "");
    } catch {
      setError("Unable to save the parent team. Please try again.");
      setParentTeamId(team.parentTeamId ?? "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="team-settings" aria-label="Team settings">
      <h2>Settings</h2>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormField id="team-parent-team" label="Parent team" error={error ?? undefined}>
          <select
            id="team-parent-team"
            name="parentTeamId"
            disabled={!canManage}
            value={parentTeamId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => setParentTeamId(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </FormField>
        {!canManage ? <p>Only an organization Owner can change the team hierarchy.</p> : null}
        {saved ? <p role="status">Parent team saved</p> : null}
        {canManage ? (
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        ) : null}
      </form>
    </section>
  );
}
