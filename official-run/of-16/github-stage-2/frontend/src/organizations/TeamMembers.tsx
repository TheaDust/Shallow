import { useEffect, useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { Button, FormField } from "../ui";
import { addTeamMember, fetchTeamMembers, removeTeamMember } from "./api";
import type { TeamMember } from "./types";

export interface TeamMembersProps {
  slug: string;
  teamName: string;
  /** Only an organization Owner may add or remove team members. */
  canManage: boolean;
}

const LOAD_ERROR = "We could not load the team members. Try again.";
const ADD_ERROR = "We could not add the member. Try again.";
const REMOVE_ERROR = "We could not remove the member. Try again.";

/**
 * Members section of a team page. Adding takes the username of an existing
 * organization member and saves the team membership immediately; each member
 * row offers the "Remove <username>" action. The "Add member" entry opens the
 * form, so only one control carries that name at a time.
 */
export function TeamMembers({ slug, teamName, canManage }: TeamMembersProps) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMembers(null);
    setFailed(false);
    setFormOpen(false);
    fetchTeamMembers(slug, teamName)
      .then((next) => {
        if (!cancelled) setMembers(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, teamName]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldError(undefined);
    setFormError(null);
    try {
      const next = await addTeamMember(slug, teamName, username);
      setMembers(next);
      setUsername("");
      setFormOpen(false);
    } catch (failure) {
      const errors = fieldErrorsOf(failure);
      if (errors?.username) setFieldError(errors.username);
      else setFormError(errorMessageOf(failure) ?? ADD_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: TeamMember) {
    if (busy) return;
    setBusy(true);
    setFieldError(undefined);
    setFormError(null);
    try {
      setMembers(await removeTeamMember(slug, teamName, member.username));
    } catch (failure) {
      setFormError(errorMessageOf(failure) ?? REMOVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <p role="alert">{LOAD_ERROR}</p>;
  if (members === null) return <p role="status">Loading members…</p>;

  return (
    <div className="team-members">
      {canManage ? (
        formOpen ? (
          <form className="app-form" noValidate onSubmit={handleAdd}>
            <FormField id="team-member-username" label="Username" error={fieldError}>
              <input
                id="team-member-username"
                name="username"
                type="text"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FormField>
            <div className="app-form__actions">
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
                Add member
              </Button>
            </div>
          </form>
        ) : (
          <div className="app-form__actions">
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              Add member
            </Button>
          </div>
        )
      ) : null}
      {formError ? (
        <p className="app-form__error" role="alert">
          {formError}
        </p>
      ) : null}
      {members.length === 0 ? (
        <p className="team-members__empty">This team has no members yet.</p>
      ) : (
        <ul className="member-list" aria-label="Team members">
          {members.map((member) => (
            <li key={member.username} className="member-list__item">
              <span className="member-list__username">{member.username}</span>
              {canManage ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void handleRemove(member);
                  }}
                >
                  Remove {member.username}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
