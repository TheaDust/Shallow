import { useEffect, useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { setTeamParent, type OrganizationTeam } from "./org-api";

export interface TeamSettingsProps {
  organization: string;
  team: string;
  /** Stored parent team of this team, or null when it has none. */
  parentTeamName: string | null;
  teams: OrganizationTeam[];
  /** Only an organization Owner may change the hierarchy. */
  canManage: boolean;
  onSaved(): void;
}

/**
 * Settings tab of a team page (REQ-2-2-2).
 *
 * The "Parent team" combobox lists the team names of the organization. A
 * selection that would make the team its own ancestor is rejected by the
 * server; the stored parent stays selected and the original hierarchy is kept.
 */
export function TeamSettings({
  organization,
  team,
  parentTeamName,
  teams,
  canManage,
  onSaved,
}: TeamSettingsProps) {
  const [parent, setParent] = useState(parentTeamName ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setParent(parentTeamName ?? "");
  }, [parentTeamName]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    const result = await setTeamParent(organization, team, parent);
    setSaving(false);
    if (!result.ok) {
      // A rejected change keeps the stored parent selected.
      setError(result.errors.parentTeam ?? result.message);
      setParent(parentTeamName ?? "");
      return;
    }
    setParent(result.data.team?.parentTeamName ?? "");
    onSaved();
  };

  return (
    <section className="team-settings" aria-label="Settings">
      {canManage ? (
        <form className="team-settings__form" onSubmit={onSubmit} noValidate>
          <FormField id="team-parent-team" label="Parent team" error={error}>
            <select
              id="team-parent-team"
              name="parentTeam"
              value={parent}
              onChange={(event) => setParent(event.target.value)}
            >
              {/* Keeps a team without a parent empty instead of selecting a
                  team it was never assigned to; not part of the option list. */}
              <option hidden value="">No parent team</option>
              {teams.map((entry) => (
                <option key={entry.name} value={entry.name}>{entry.name}</option>
              ))}
            </select>
          </FormField>
          <Button type="submit" variant="primary" disabled={saving}>Save</Button>
        </form>
      ) : (
        <p className="team-settings__restricted">
          Only an organization Owner can change the team hierarchy.
        </p>
      )}
    </section>
  );
}
