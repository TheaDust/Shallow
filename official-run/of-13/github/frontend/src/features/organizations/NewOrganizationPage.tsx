import { useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { createOrganization } from "../../lib/organizations-api";
import { fieldErrorsOf, messageOf, type FieldErrors } from "../../lib/session-api";
import { Button, FormField, fieldDescriptionIds } from "../../ui";
import { ProtectedPage } from "../account/ProtectedPage";

/**
 * Organization creation. Server-side validation answers with the field reason
 * (duplicate identifier, malformed identifier, blank display name); the typed
 * values stay on the page so the user can correct them.
 */
function NewOrganizationForm() {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const organization = await createOrganization({ name, displayName });
      setFieldErrors({});
      navigate(`/organizations/${organization.name}`);
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFailure(messageOf(error, "Unable to create the organization right now."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="organization-form" noValidate onSubmit={handleSubmit}>
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      <FormField id="organization-name" label="Organization name" error={fieldErrors.name}>
        <input
          id="organization-name"
          name="name"
          type="text"
          autoComplete="off"
          aria-describedby={fieldDescriptionIds("organization-name", {
            error: Boolean(fieldErrors.name),
          })}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <FormField id="organization-display-name" label="Display name" error={fieldErrors.displayName}>
        <input
          id="organization-display-name"
          name="displayName"
          type="text"
          autoComplete="off"
          aria-describedby={fieldDescriptionIds("organization-display-name", {
            error: Boolean(fieldErrors.displayName),
          })}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Create organization
      </Button>
    </form>
  );
}

export function NewOrganizationPage() {
  return (
    <ProtectedPage title="New organization">
      <NewOrganizationForm />
      <p className="organization-form__aside">
        <a href="#/organizations">Your organizations</a>
      </p>
    </ProtectedPage>
  );
}
