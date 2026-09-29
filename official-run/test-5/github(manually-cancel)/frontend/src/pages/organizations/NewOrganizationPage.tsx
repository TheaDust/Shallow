import { useState, type ChangeEvent, type FormEvent } from "react";

import { createOrganization, organizationPath } from "../../org/org-api";
import type { OrganizationErrors } from "../../org/types";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { navigate } from "../../lib/hash-route";
import { useSession } from "../../session/SessionProvider";
import { AuthenticationRequired, BusyMain } from "../common";

/**
 * REQ-2-1-2: the organization-creation page opened by “New organization”. The
 * server validates the identifier and the display name; a rejected submit keeps
 * the entered values and reports the reason beside the matching field.
 */
export function NewOrganizationPage() {
  const { status, account } = useSession();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<OrganizationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await createOrganization({ name, displayName });
      if (result.ok) {
        setErrors({});
        navigate(organizationPath(result.organization.name));
        return;
      }
      setErrors(result.errors);
    } catch {
      setFormError("Unable to create the organization. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading") return <BusyMain />;
  if (!account) return <AuthenticationRequired />;

  return (
    <main>
      <h1>New organization</h1>
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <FormField id="organization-name" label="Organization name" error={errors.name}>
          <input
            id="organization-name"
            name="name"
            type="text"
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="organization-display-name" label="Display name" error={errors.displayName}>
          <input
            id="organization-display-name"
            name="displayName"
            type="text"
            value={displayName}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)}
          />
        </FormField>
        {formError ? (
          <p className="auth-form__error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Create organization
        </Button>
      </form>
    </main>
  );
}
