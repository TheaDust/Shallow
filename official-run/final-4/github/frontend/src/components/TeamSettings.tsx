import { useEffect, useState } from "react";

import { fetchOrganizationTeams, fetchTeam, saveTeamParent } from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { ErrorNote, LoadingNote } from "./ViewState";

const NO_PARENT = "";

/** Settings panel of a team: the parent-team combobox and its Save action. */
export function TeamSettings({ organizationId, teamName }: { organizationId: string; teamName: string }) {
  const team = useAsyncData(() => fetchTeam(organizationId, teamName), [organizationId, teamName]);
  const teams = useAsyncData(() => fetchOrganizationTeams(organizationId), [organizationId]);
  const [parentName, setParentName] = useState<string>(NO_PARENT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The saved parent is the source of truth: it is re-applied whenever the team
  // resource reloads, so a rejected change never becomes the selected value.
  useEffect(() => {
    if (team.status === "ready" && team.data) setParentName(team.data.parentName ?? NO_PARENT);
  }, [team.status, team.data]);

  if (team.status === "loading") return <LoadingNote label="Loading team settings…" />;
  if (team.status === "error" && team.error) return <ErrorNote error={team.error} onRetry={team.reload} />;
  if (!team.data) return <LoadingNote label="Loading team settings…" />;

  const options = [
    { value: NO_PARENT, label: "No parent" },
    ...(teams.data ?? [])
      .filter((option) => option.name !== teamName)
      .map((option) => ({ value: option.name, label: option.name })),
  ];

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveTeamParent(
        organizationId,
        teamName,
        parentName === NO_PARENT ? null : parentName,
      );
      if (result.ok) {
        setMessage("Parent team saved");
        team.reload();
      } else {
        setError(result.fieldErrors.parentName ?? result.message);
      }
    } catch {
      setError("Unable to save the parent team. Please try again.");
    }
    setBusy(false);
  };

  return (
    <form
      className="team-settings"
      aria-label="Team settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <Combobox
        id="team-parent"
        label="Parent team"
        options={options}
        value={parentName}
        disabled={teams.status !== "ready"}
        onChange={(event) => setParentName(event.target.value)}
      />
      <div className="team-settings__actions">
        <Button type="submit" variant="primary" disabled={busy || teams.status !== "ready"}>
          Save
        </Button>
      </div>
      {error ? (
        <p className="team-settings__error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="team-settings__status" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
