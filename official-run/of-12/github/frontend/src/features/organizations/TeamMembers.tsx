import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { readFormValues } from "../../lib/forms";
import { addTeamMember, removeTeamMember } from "./org-api";

export interface TeamMembersProps {
  organization: string;
  team: string;
  members: string[];
  /** Only an organization Owner may maintain the members of a team. */
  canManage: boolean;
  onChanged(): void;
}

/**
 * Members tab of a team page (REQ-2-2-2).
 *
 * The "Add member" button opens the "Username" field and the submit button
 * with the same name; only the button of the current step is rendered, so the
 * actionable match is always unambiguous. A member is removed immediately by
 * "Remove <username>" without a second confirmation step.
 */
export function TeamMembers({ organization, team, members, canManage, onChanged }: TeamMembersProps) {
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["username"]);
    setErrors({});
    setMessage("");
    setSubmitting(true);
    const result = await addTeamMember(organization, team, values.username ?? "");
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(Object.keys(result.errors).length > 0 ? "" : result.message);
      return;
    }
    setAdding(false);
    onChanged();
  };

  const onRemove = async (username: string) => {
    setBusy(true);
    setErrors({});
    setMessage("");
    const result = await removeTeamMember(organization, team, username);
    setBusy(false);
    if (!result.ok) {
      setMessage(Object.values(result.errors)[0] ?? result.message);
      return;
    }
    setRemoving(null);
    onChanged();
  };

  return (
    <section className="team-members" aria-label="Members">
      {canManage ? (
        adding ? (
          <form className="team-members__form" onSubmit={onSubmit} noValidate>
            <FormField id="team-member-username" label="Username" error={errors.username}>
              <input
                id="team-member-username"
                name="username"
                type="text"
                autoComplete="off"
                aria-required="true"
                aria-invalid={errors.username ? true : undefined}
              />
            </FormField>
            {message ? <p role="alert">{message}</p> : null}
            <div className="team-members__actions">
              <Button type="submit" variant="primary" disabled={submitting}>Add member</Button>
              <Button
                onClick={() => {
                  setAdding(false);
                  setErrors({});
                  setMessage("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="team-members__actions">
            <Button variant="primary" onClick={() => setAdding(true)}>Add member</Button>
          </p>
        )
      ) : null}

      {message && !adding ? <p role="alert">{message}</p> : null}

      {members.length === 0 ? (
        <p className="team-members__empty">This team has no members yet.</p>
      ) : (
        <ul className="team-members__list">
          {members.map((username) => (
            <li key={username} className="team-members__person" aria-label={username}>
              <span className="team-members__username">{username}</span>
              {canManage ? (
                <Button
                  className="team-members__remove"
                  aria-label={`Remove ${username}`}
                  disabled={busy && removing === username}
                  onClick={() => {
                    setRemoving(username);
                    void onRemove(username);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
