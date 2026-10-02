import { useState, type FormEvent } from "react";

import { createOrganization } from "../organizations/api";
import { errorMessageOf, fieldErrorsOf } from "../auth/api";
import { navigate } from "../lib/hash-route";
import { Button, FormField, fieldDescriptionIds } from "../ui";

interface OrganizationFormErrors {
  name?: string;
  displayName?: string;
}

const FALLBACK_ERROR = "We could not create the organization. Try again.";

/**
 * Organization creation form. The server owns the name and display-name rules
 * and every message; a rejected submission shows the returned reasons and never
 * opens an organization, while a successful one stores the organization with
 * the account's Owner membership and opens its overview.
 */
export function NewOrganizationPage() {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<OrganizationFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const organization = await createOrganization({ name, displayName });
      navigate(`/organizations/${organization.slug}`);
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      if (fieldErrors) setErrors({ name: fieldErrors.name, displayName: fieldErrors.displayName });
      else setFormError(errorMessageOf(failure) ?? FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <h1>New organization</h1>
      <p className="page__lead">
        Organizations group repositories, people and teams. You become the Owner of the organization
        you create.
      </p>
      <form className="app-form" aria-label="New organization" noValidate onSubmit={handleSubmit}>
        <FormField
          id="organization-name"
          label="Organization name"
          description="1–39 lowercase letters, digits or single hyphens. This name is unique across ShallowCode and is used in the organization address."
          error={errors.name}
        >
          <input
            id="organization-name"
            name="name"
            type="text"
            autoComplete="off"
            aria-describedby={fieldDescriptionIds("organization-name", {
              description: true,
              error: Boolean(errors.name),
            })}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField
          id="organization-display-name"
          label="Display name"
          description="The name shown on the organization pages."
          error={errors.displayName}
        >
          <input
            id="organization-display-name"
            name="displayName"
            type="text"
            autoComplete="off"
            aria-describedby={fieldDescriptionIds("organization-display-name", {
              description: true,
              error: Boolean(errors.displayName),
            })}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="app-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="app-form__actions">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            Create organization
          </Button>
        </div>
      </form>
    </section>
  );
}
