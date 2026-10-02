import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { createOrganization } from "../features/organizations/org-api";

const FIELD_IDS = {
  name: "organization-name",
  displayName: "organization-display-name",
};

/**
 * Organization-creation page (REQ-2-1-2).
 *
 * The rules are enforced by the server; the field messages it returns are
 * rendered beside the matching input and the form stays open, so the entered
 * non-sensitive values can be corrected and resubmitted. On success the user
 * lands on the new organization overview.
 */
export function NewOrganizationPage() {
  const { user, loading, refresh } = useSession();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form, ["name", "displayName"]);
    setErrors({});
    setSubmitting(true);
    const result = await createOrganization({
      name: values.name ?? "",
      displayName: values.displayName ?? "",
    });
    if (!result.ok) {
      setSubmitting(false);
      setErrors(result.errors);
      return;
    }
    await refresh();
    setSubmitting(false);
    navigate(`/organizations/${result.organization.name}`);
  };

  return (
    <main className="new-organization-page">
      <h1>New organization</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {!loading && !user ? (
        <p className="new-organization-page__signed-out">
          You need to sign in to create an organization. <a href="#/sign-in">Sign in</a>
        </p>
      ) : null}
      {user ? (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <FormField id={FIELD_IDS.name} label="Organization name" error={errors.name}>
            <input
              id={FIELD_IDS.name}
              name="name"
              type="text"
              autoComplete="off"
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
            />
          </FormField>
          <FormField id={FIELD_IDS.displayName} label="Display name" error={errors.displayName}>
            <input
              id={FIELD_IDS.displayName}
              name="displayName"
              type="text"
              autoComplete="off"
              aria-required="true"
              aria-invalid={errors.displayName ? true : undefined}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create organization
          </Button>
        </form>
      ) : null}
    </main>
  );
}
