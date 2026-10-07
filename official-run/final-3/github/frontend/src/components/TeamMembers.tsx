import { useState, type FormEvent } from "react";

import { addTeamMember, fetchTeamMembers, removeTeamMember } from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { ErrorNote, LoadingNote } from "./ViewState";

/**
 * Members panel of a team. "Add member" opens the inline form (whose submit
 * button keeps the same name) so exactly one "Add member" control is present
 * at a time; every listed member carries a "Remove <username>" button.
 */
export function TeamMembers({ organizationId, teamName }: { organizationId: string; teamName: string }) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchTeamMembers(organizationId, teamName),
    [organizationId, teamName],
  );
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await addTeamMember(organizationId, teamName, username.trim());
      if (result.ok) {
        setUsername("");
        setAdding(false);
        reload();
      } else {
        setFormError(result.fieldErrors.username ?? result.message);
      }
    } catch {
      setFormError("Unable to add the member. Please try again.");
    }
    setBusy(false);
  };

  const remove = async (member: string) => {
    if (removing) return;
    setRemoving(member);
    setFormError(null);
    try {
      await removeTeamMember(organizationId, teamName, member);
      reload();
    } catch {
      setFormError(`Unable to remove ${member}. Please try again.`);
    }
    setRemoving(null);
  };

  return (
    <div className="team-members">
      {adding ? (
        <form className="team-members__form" aria-label="Add member" onSubmit={submit} noValidate>
          <FormField id="team-member-username" label="Username" error={formError ?? undefined}>
            <input
              id="team-member-username"
              name="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <div className="team-members__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Add member
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAdding(false);
                setUsername("");
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="team-members__actions">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add member
          </Button>
        </p>
      )}

      {formError && !adding ? (
        <p className="team-members__error" role="alert">
          {formError}
        </p>
      ) : null}

      {status === "loading" ? <LoadingNote label="Loading team members…" /> : null}
      {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
      {status === "ready" && data ? (
        data.length === 0 ? (
          <p className="team-members__empty">This team has no members yet.</p>
        ) : (
          <ul className="member-list" aria-label="Team members">
            {data.map((member) => (
              <li key={member} className="member-list__item">
                <span className="member-list__name">{member}</span>
                <Button
                  variant="secondary"
                  aria-label={`Remove ${member}`}
                  disabled={removing === member}
                  onClick={() => void remove(member)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
