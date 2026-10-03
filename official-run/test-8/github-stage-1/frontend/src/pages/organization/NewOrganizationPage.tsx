import { useState, type FormEvent } from "react";

import { createOrganization } from "../../api/organizations";
import { fieldErrorsOf, messageOf, type Account, type FieldErrors } from "../../api/auth";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash, navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";

/** Organization creation form reached from “New organization”. */
export function NewOrganizationPage({ account }: { account: Account }) {
  const [organizationName, setOrganizationName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await createOrganization({ organizationName, displayName });
      navigate(`/organizations/${result.organization.slug}`);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, "Organization creation failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <SiteHeader account={account} />
      <h1>New organization</h1>
      <form
        className="account-form"
        aria-label="New organization"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <FormField id="organization-name" label="Organization name" error={errors.organizationName}>
          <input
            id="organization-name"
            name="organizationName"
            type="text"
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
          />
        </FormField>
        <FormField id="organization-display-name" label="Display name" error={errors.displayName}>
          <input
            id="organization-display-name"
            name="displayName"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Create organization
        </Button>
      </form>
      <p>
        <a href={makeHash("/organizations")}>Back to your organizations</a>
      </p>
    </main>
  );
}
