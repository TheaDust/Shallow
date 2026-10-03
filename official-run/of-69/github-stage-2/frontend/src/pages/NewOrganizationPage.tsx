import { useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { apiFieldErrors } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createOrganization } from "../lib/organization-api";
import { organizationPath } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { apiErrorMessage } from "../lib/use-async-data";
import { Button, FormField } from "../ui";

type FieldName = "name" | "displayName";
type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * Organization creation form. Every rejected reason is reported in its own
 * field, and a successful submission opens the new organization overview.
 */
export function NewOrganizationPage({ account }: { account: Account }) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const organization = await createOrganization({ name, displayName });
      navigate(organizationPath(organization.name));
    } catch (caught) {
      const fieldErrors = apiFieldErrors(caught) as FieldErrors;
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) setFormError(apiErrorMessage(caught, "Unable to create the organization."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>New organization</h1>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <FormField id="organization-name" label="Organization name" error={errors.name}>
            <input
              id="organization-name"
              name="name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField id="organization-display-name" label="Display name" error={errors.displayName}>
            <input
              id="organization-display-name"
              name="displayName"
              type="text"
              autoComplete="off"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Create organization
          </Button>
        </form>
      </main>
    </div>
  );
}
