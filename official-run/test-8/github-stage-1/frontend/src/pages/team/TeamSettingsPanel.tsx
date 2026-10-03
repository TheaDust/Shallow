import { useEffect, useState } from "react";

import { saveTeamParent, type TeamDetail } from "../../api/organizations";
import { fieldErrorsOf, messageOf } from "../../api/auth";
import { Button, Combobox, type ComboboxOption } from "../../ui";

export interface TeamSettingsPanelProps {
  slug: string;
  teamSlug: string;
  detail: TeamDetail | null;
  reload(): void;
}

/** Team “Settings”: the “Parent team” combobox and its “Save” button. */
export function TeamSettingsPanel({ slug, teamSlug, detail, reload }: TeamSettingsPanelProps) {
  const savedParent = detail?.team.parent ?? "";
  const [parent, setParent] = useState(savedParent);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setParent(savedParent);
  }, [savedParent]);

  const options: ComboboxOption[] = [
    { value: "", label: "No parent" },
    ...(detail?.parentOptions ?? []).map((team) => ({ value: team, label: team })),
  ];

  const save = async () => {
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      await saveTeamParent(slug, teamSlug, parent);
      reload();
      setStatus("Team hierarchy saved");
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setError(fields.parentTeam ?? messageOf(failure, "Unable to save team hierarchy"));
      // A rejected change leaves the previously saved parent selected.
      setParent(savedParent);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="team-panel">
      <Combobox
        id={`parent-team-${teamSlug}`}
        label="Parent team"
        options={options}
        value={parent}
        onChange={(event) => setParent(event.target.value)}
      />
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="form-status" role="status">
          {status}
        </p>
      ) : null}
      <Button variant="primary" onClick={() => void save()} disabled={pending}>
        Save
      </Button>
    </section>
  );
}
