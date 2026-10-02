import { useEffect, useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { createTeam, fetchOrganization, type OrganizationDetail } from "../features/organizations/org-api";
import { NotFoundPage } from "./NotFoundPage";

export interface NewTeamPageProps {
  /** Organization identifier taken from the address. */
  organization: string;
}

/**
 * Team-creation page (REQ-2-2-1).
 *
 * The team name rules are enforced by the server; a rejected name keeps the
 * form open with the reason beside the field and no team is created. On
 * success the user lands on the new team page.
 */
export function NewTeamPage({ organization }: NewTeamPageProps) {
  const { user, loading } = useSession();
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetchOrganization(organization)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
    };
  }, [organization]);

  if (missing) return <NotFoundPage />;

  const isOwner = detail?.viewerRole === "Owner";

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = readFormValues(event.currentTarget, ["name", "description", "parentTeam"]);
    setErrors({});
    setMessage("");
    setSubmitting(true);
    const result = await createTeam(organization, {
      name: values.name ?? "",
      description: values.description ?? "",
      parentTeam: values.parentTeam ?? "",
    });
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(Object.keys(result.errors).length > 0 ? "" : result.message);
      return;
    }
    navigate(`/organizations/${organization}/teams/${result.data.name}`);
  };

  return (
    <main className="new-team-page">
      <h1>New team</h1>
      {loading || !detail ? <p role="status">Loading…</p> : null}
      {!loading && !user ? (
        <p className="new-team-page__signed-out">
          You need to sign in to create a team. <a href="#/sign-in">Sign in</a>
        </p>
      ) : null}
      {user && detail && !isOwner ? (
        <p className="new-team-page__restricted">Only an organization Owner can create a team.</p>
      ) : null}
      {user && isOwner ? (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <FormField id="team-name" label="Team name" error={errors.name}>
            <input
              id="team-name"
              name="name"
              type="text"
              autoComplete="off"
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
            />
          </FormField>
          <FormField id="team-description" label="Description">
            <textarea id="team-description" name="description" rows={3} />
          </FormField>
          <FormField id="team-parent-team" label="Parent team" error={errors.parentTeam}>
            <select id="team-parent-team" name="parentTeam" defaultValue="">
              <option value="">No parent team</option>
              {detail.teams.map((team) => (
                <option key={team.name} value={team.name}>{team.name}</option>
              ))}
            </select>
          </FormField>
          {message ? <p role="alert">{message}</p> : null}
          <Button type="submit" variant="primary" disabled={submitting}>Create team</Button>
        </form>
      ) : null}
    </main>
  );
}
