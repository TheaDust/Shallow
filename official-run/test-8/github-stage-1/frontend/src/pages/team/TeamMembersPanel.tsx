import { useState, type FormEvent } from "react";

import { addTeamMember, removeTeamMember, type TeamDetail } from "../../api/organizations";
import { fieldErrorsOf, messageOf } from "../../api/auth";
import { makeHash } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";

export interface TeamMembersPanelProps {
  slug: string;
  teamSlug: string;
  detail: TeamDetail | null;
  reload(): void;
}

/**
 * Team “Members”: an “Add member” entry opens the “Username” form, and every
 * added member exposes a “Remove <username>” button that updates the list.
 */
export function TeamMembersPanel({ slug, teamSlug, detail, reload }: TeamMembersPanelProps) {
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const members = detail?.members ?? [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setFieldError(null);
    setFormError(null);
    try {
      await addTeamMember(slug, teamSlug, username);
      setUsername("");
      setAdding(false);
      reload();
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (fields.username) setFieldError(fields.username);
      else setFormError(messageOf(error, "Unable to add member"));
    } finally {
      setPending(false);
    }
  };

  const remove = async (member: string) => {
    setFormError(null);
    try {
      await removeTeamMember(slug, teamSlug, member);
      reload();
    } catch (error) {
      setFormError(messageOf(error, "Unable to remove member"));
    }
  };

  return (
    <section className="team-panel">
      {adding ? (
        <form className="account-form" aria-label="Add member" noValidate onSubmit={(event) => void submit(event)}>
          <FormField id={`team-member-username-${teamSlug}`} label="Username" error={fieldError ?? undefined}>
            <input
              id={`team-member-username-${teamSlug}`}
              name="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={pending}>
            Add member
          </Button>
        </form>
      ) : (
        <p>
          <a
            href={makeHash(`/organizations/${slug}/teams/${teamSlug}/members`)}
            onClick={(event) => {
              event.preventDefault();
              setAdding(true);
            }}
          >
            Add member
          </a>
        </p>
      )}
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <ul className="team-member-list">
        {members.map((member) => (
          <li key={member.id} className="team-member-list__item">
            <span className="team-member-list__username">{member.username}</span>
            <Button variant="secondary" onClick={() => void remove(member.username)}>
              Remove {member.username}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
