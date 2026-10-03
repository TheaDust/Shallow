import { useEffect, useState, type FormEvent } from "react";

import { TeamLayout } from "../components/TeamLayout";
import { fetchTeam, saveTeamParent } from "../lib/organization-api";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, Combobox } from "../ui";

/**
 * Team settings: the “Parent team” combobox and its “Save” action. A rejected
 * hierarchy change keeps the previously saved parent selected.
 */
export function TeamSettingsPage({ organization, team }: { organization: string; team: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchTeam(organization, team), [organization, team]);
  const [parentTeam, setParentTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (detail.data) setParentTeam(detail.data.team.parentTeamName ?? "");
  }, [detail.data]);

  const options = [
    { value: "", label: "No parent" },
    ...(detail.data?.teams ?? []).map((option) => ({ value: option.name, label: option.name })),
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveTeamParent(organization, team, parentTeam);
      setParentTeam(saved.parentTeamName ?? "");
      setMessage("Parent team saved");
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to save the parent team."));
      // The rejected change is not applied, so the saved parent stays selected.
      setParentTeam(detail.data?.team.parentTeamName ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TeamLayout
      organizationName={organization}
      teamName={team}
      organizationDisplayName={detail.data?.organization.displayName}
      heading={team}
      activeSection="settings"
      account={account}
    >
      {detail.loading ? <p role="status">Loading team settings…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {detail.data && detail.data.canManage ? (
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <Combobox
            id="parent-team"
            label="Parent team"
            value={parentTeam}
            options={options}
            onChange={(event) => setParentTeam(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </form>
      ) : null}
    </TeamLayout>
  );
}
