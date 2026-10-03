import { useState, type FormEvent } from "react";

import { OrganizationLayout } from "../components/OrganizationLayout";
import { apiFieldErrors } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createTeam } from "../lib/organization-api";
import { organizationPath } from "../lib/routes";
import { apiErrorMessage } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, FormField } from "../ui";

/** Team creation form for the current organization. */
export function NewTeamPage({ organization }: { organization: string }) {
  const { account } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      const team = await createTeam(organization, name);
      navigate(organizationPath(organization, "teams", team.name));
    } catch (caught) {
      const fieldErrors = apiFieldErrors(caught);
      if (fieldErrors.name) setError(fieldErrors.name);
      else setFormError(apiErrorMessage(caught, "Unable to create the team."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OrganizationLayout
      organizationName={organization}
      organization={null}
      heading="New team"
      activeTab="teams"
      account={account}
    >
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <FormField id="team-name" label="Team name" error={error ?? undefined}>
          <input
            id="team-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <Button type="submit" variant="primary" disabled={busy}>
          Create team
        </Button>
      </form>
    </OrganizationLayout>
  );
}
