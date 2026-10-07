import { useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { createOrganization, type OrganizationFieldErrors } from "../lib/org-api";
import { navigate } from "../lib/hash-route";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/**
 * Organization creation form. The server owns the rules; this page mirrors the
 * returned field errors, keeps the submitted values and only navigates to the
 * new organization overview after a successful creation.
 */
export function NewOrganizationPage() {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<OrganizationFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setMessage(null);
    try {
      const result = await createOrganization({ name, displayName });
      if (result.ok) {
        navigate(`/orgs/${encodeURIComponent(result.value.id)}`);
        setBusy(false);
        return;
      }
      setFieldErrors(result.fieldErrors);
      if (Object.keys(result.fieldErrors).length === 0) setMessage(result.message);
    } catch {
      setMessage("Unable to create the organization. Please try again.");
    }
    setBusy(false);
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body organizations">
        <h1 className="organizations__title">New organization</h1>
        <form className="organizations__form" aria-label="New organization" onSubmit={submit} noValidate>
          {message ? (
            <p className="organizations__error" role="alert">
              {message}
            </p>
          ) : null}
          <FormField id="organization-name" label="Organization name" error={fieldErrors.name}>
            <input
              id="organization-name"
              name="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField id="organization-display-name" label="Display name" error={fieldErrors.displayName}>
            <input
              id="organization-display-name"
              name="displayName"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Create organization
          </Button>
        </form>
      </section>
    </main>
  );
}
