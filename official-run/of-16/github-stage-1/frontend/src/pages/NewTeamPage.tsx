import { useState, type FormEvent } from "react";

import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { navigate } from "../lib/hash-route";
import { createTeam } from "../organizations/api";
import { Button, FormField } from "../ui";

interface TeamFormErrors {
  name?: string;
}

const FALLBACK_ERROR = "We could not create the team. Try again.";

/**
 * Team creation form of one organization. The server owns the team-name rules
 * and the exact message; a rejected submission shows the returned reason and
 * never opens a team, while a successful one stores the team in the
 * organization and opens its overview.
 */
export function NewTeamPage({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<TeamFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const team = await createTeam(slug, { name });
      navigate(`/organizations/${slug}/teams/${team.name}`);
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors?.name) setErrors({ name: fieldErrors.name });
      else setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1>New team</h1>
      <p className="page__lead">
        Teams group the members of {slug}. A team name is unique inside this organization.
      </p>
      <form className="app-form" aria-label="New team" noValidate onSubmit={handleSubmit}>
        <FormField
          id="team-name"
          label="Team name"
          description="1–50 lowercase letters, digits or hyphens, without a leading or trailing hyphen."
          error={errors.name}
        >
          <input
            id="team-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Create team
          </Button>
        </div>
      </form>
    </section>
  );
}
