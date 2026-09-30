import { useState } from "react";

import { readErrorFields } from "../lib/api";
import { addTeamMember, removeTeamMember, type OrganizationTeamMember } from "../lib/organizations-api";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

export interface TeamMembersSectionProps {
  login: string;
  team: string;
  members: OrganizationTeamMember[];
  /** Only an organization Owner maintains the members and the hierarchy. */
  canManage: boolean;
  onChanged(): void;
}

interface AddTeamMemberFormProps {
  login: string;
  team: string;
  onAdded(): void;
  onCancel(): void;
}

/**
 * Add-member step of the team page (REQ-2-2-2): the textbox "Username" and the
 * submission button "Add member". The opening button of the same name is not
 * rendered while this step is shown, so the submission action is unambiguous. A
 * rejected identifier keeps the form and the typed value for a correction.
 */
function AddTeamMemberForm({ login, team, onAdded, onCancel }: AddTeamMemberFormProps) {
  const [username, setUsername] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="team-members__add"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setErrors({});
        try {
          await addTeamMember(login, team, username);
          onAdded();
        } catch (error) {
          setErrors(readErrorFields(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FormField id="team-member-username" label="Username" error={errors.username}>
        <input
          id="team-member-username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </FormField>
      <div className="team-members__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Add member
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Direct members of one team: a membership is an independent persisted
 * relationship, so a parent or child team never contributes a row here. The
 * removal button acts immediately, without a second confirmation step.
 */
export function TeamMembersSection({
  login,
  team,
  members,
  canManage,
  onChanged,
}: TeamMembersSectionProps) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (member: OrganizationTeamMember) => {
    setBusy(true);
    setError(null);
    try {
      await removeTeamMember(login, team, member.username);
      onChanged();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "The team member could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canManage && !adding ? (
        <p>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add member
          </Button>
        </p>
      ) : null}
      {canManage && adding ? (
        <AddTeamMemberForm
          login={login}
          team={team}
          onAdded={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="team-members__error">
          {error}
        </p>
      ) : null}
      {members.length === 0 ? (
        <p>This team has no members yet.</p>
      ) : (
        <ul className="team-members__list">
          {members.map((member) => (
            <li key={member.accountId} className="team-members__item">
              <span className="team-members__username">{member.username}</span>
              {canManage ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void remove(member)}
                >
                  {`Remove ${member.username}`}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
