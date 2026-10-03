import { useState, type FormEvent } from "react";

import { createTeam } from "../../api/organizations";
import { fieldErrorsOf, messageOf, type Account, type FieldErrors } from "../../api/auth";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash, navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";

/** “New team” form on an organization's Teams page. */
export function NewTeamPage({ slug, account }: { slug: string; account: Account }) {
  const [teamName, setTeamName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await createTeam(slug, teamName);
      navigate(`/organizations/${slug}/teams/${result.team.slug}`);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, "Team creation failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <SiteHeader account={account} />
      <h1>New team</h1>
      <form className="account-form" aria-label="New team" noValidate onSubmit={(event) => void submit(event)}>
        <FormField id="team-name" label="Team name" error={errors.teamName}>
          <input
            id="team-name"
            name="teamName"
            type="text"
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Create team
        </Button>
      </form>
      <p>
        <a href={makeHash(`/organizations/${slug}/teams`)}>Back to teams</a>
      </p>
    </main>
  );
}
