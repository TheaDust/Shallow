import { useState, type ChangeEvent, type FormEvent } from "react";

import { addTeamMember, removeTeamMember } from "../../org/org-api";
import type { TeamDetail } from "../../org/types";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";

export interface TeamMembersPanelProps {
  organizationName: string;
  team: TeamDetail;
  /** Only an organization Owner may add or remove team members. */
  canManage: boolean;
  onChanged(): void;
}

/**
 * REQ-2-2-2: direct team members. “Add member” opens a form with the labeled
 * “Username” textbox and the submitting “Add member” button; while the form is
 * open that button is the only actionable “Add member” match in the view.
 */
export function TeamMembersPanel({
  organizationName,
  team,
  canManage,
  onChanged,
}: TeamMembersPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addTeamMember(organizationName, team.name, username);
      if (result.ok) {
        setUsername("");
        setFormOpen(false);
        onChanged();
        return;
      }
      setError(result.errors.username ?? "Unable to add the member.");
    } catch {
      setError("Unable to add the member. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeTeamMember(organizationName, team.name, member);
      onChanged();
    } catch {
      setError("Unable to remove the member. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="team-members" aria-label="Team members">
      <h2>Members</h2>
      {!canManage ? (
        <p>Only an organization Owner can manage team members.</p>
      ) : formOpen ? (
        <form className="auth-form" onSubmit={submit} noValidate>
          <FormField id="team-member-username" label="Username" error={error ?? undefined}>
            <input
              id="team-member-username"
              name="username"
              type="text"
              value={username}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)}
            />
          </FormField>
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Add member
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setUsername("");
                setError(null);
                setFormOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p>
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Add member
            </Button>
          </p>
          {error ? (
            <p className="auth-form__error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
      {team.members.length === 0 ? (
        <p>This team has no direct members.</p>
      ) : (
        <ul className="team-members__list">
          {team.members.map((member) => (
            <li key={member}>
              <span className="team-members__username">{member}</span>
              {canManage ? (
                <Button disabled={busy} onClick={() => void remove(member)}>
                  {`Remove ${member}`}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
