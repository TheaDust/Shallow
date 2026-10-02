import { useState, type FormEvent } from "react";

import {
  addTeamMember,
  removeTeamMember,
  type TeamMember,
} from "../../lib/organizations-api";
import { fieldErrorsOf, messageOf, type FieldErrors } from "../../lib/session-api";
import { Button, FormField, fieldDescriptionIds } from "../../ui";

export interface TeamMembersPanelProps {
  organizationName: string;
  teamName: string;
  members: TeamMember[];
  canManage: boolean;
  onChanged(): void;
}

/**
 * The team "Members" tab. Team membership is direct: hierarchy adds no member.
 * An Owner can add a current organization member or remove one immediately.
 */
export function TeamMembersPanel({
  organizationName,
  teamName,
  members,
  canManage,
  onChanged,
}: TeamMembersPanelProps) {
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await addTeamMember(organizationName, teamName, username);
      setFieldErrors({});
      setUsername("");
      setAdding(false);
      onChanged();
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to add that member right now."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: string) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await removeTeamMember(organizationName, teamName, member);
      setFieldErrors({});
      onChanged();
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFailure(
        Object.values(errors)[0] ?? messageOf(error, "Unable to remove that member right now."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="team-members" aria-label="Members">
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      {canManage && !adding ? (
        <p className="team-members__actions">
          <Button
            onClick={() => {
              setAdding(true);
              setFailure(null);
            }}
          >
            Add member
          </Button>
        </p>
      ) : null}
      {canManage && adding ? (
        <form className="team-members__form" noValidate onSubmit={handleAdd}>
          <FormField id="team-member-username" label="Username" error={fieldErrors.username}>
            <input
              id="team-member-username"
              name="username"
              type="text"
              autoComplete="off"
              aria-describedby={fieldDescriptionIds("team-member-username", {
                error: Boolean(fieldErrors.username),
              })}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Add member
          </Button>
        </form>
      ) : null}
      {members.length === 0 ? <p role="status">No team members yet.</p> : null}
      <ul className="team-members__list">
        {members.map((member) => (
          <li key={member.username} className="team-members__item">
            <span className="team-members__username">{member.username}</span>
            {canManage ? (
              <Button
                aria-label={`Remove ${member.username}`}
                disabled={busy}
                onClick={() => void handleRemove(member.username)}
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
