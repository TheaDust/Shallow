import { useEffect, useState, type FormEvent } from "react";

import { TeamLayout } from "../components/TeamLayout";
import { apiErrorMessage } from "../lib/use-async-data";
import { addTeamMember, fetchTeamMembers, removeTeamMember } from "../lib/organization-api";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, FormField } from "../ui";

/**
 * Team members. “Add member” opens the “Username” form, an added organization
 * member appears in the list with its own “Remove <username>” button, and the
 * list reflects the persisted team membership.
 */
export function TeamMembersPage({ organization, team }: { organization: string; team: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchTeamMembers(organization, team), [organization, team]);
  const [members, setMembers] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (detail.data) setMembers(detail.data.members.map((member) => member.username));
  }, [detail.data]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await addTeamMember(organization, team, username);
      setMembers(result.members.map((member) => member.username));
      setAdding(false);
      setUsername("");
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to add the member."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: string) {
    setError(null);
    try {
      const result = await removeTeamMember(organization, team, member);
      setMembers(result.members.map((entry) => entry.username));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to remove the member."));
    }
  }

  const canManage = detail.data?.canManage ?? false;

  return (
    <TeamLayout
      organizationName={organization}
      teamName={team}
      organizationDisplayName={detail.data?.organization.displayName}
      heading={team}
      activeSection="members"
      account={account}
    >
      {detail.loading ? <p role="status">Loading team members…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {canManage ? (
        adding ? (
          <form className="auth-form auth-form--inline" noValidate onSubmit={handleAdd}>
            <FormField id="team-member-username" label="Username" error={error ?? undefined}>
              <input
                id="team-member-username"
                name="username"
                type="text"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FormField>
            <Button type="submit" variant="primary" disabled={busy}>
              Add member
            </Button>
          </form>
        ) : (
          <p className="page-hint">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add member
            </Button>
          </p>
        )
      ) : null}
      {error && !adding ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {members ? (
        members.length > 0 ? (
          <ul className="member-list">
            {members.map((member) => (
              <li key={member} className="member-list__item">
                <span className="member-list__username">{member}</span>
                {canManage ? (
                  <Button aria-label={`Remove ${member}`} onClick={() => handleRemove(member)}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>This team has no members.</p>
        )
      ) : null}
    </TeamLayout>
  );
}
