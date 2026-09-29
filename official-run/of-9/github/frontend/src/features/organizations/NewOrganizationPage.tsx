import { useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";
import { createOrganization, type FieldErrors } from "./api";

export function NewOrganizationPage() {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await createOrganization({ name, displayName });
      if (result.ok) {
        navigate(`/orgs/${result.organization.id}`);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="org-form-page">
      <h1>New organization</h1>
      <form className="org-form" onSubmit={submit} noValidate>
        <FormField id="organization-name" label="Organization name" error={errors.name}>
          <input
            id="organization-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="organization-display-name" label="Display name" error={errors.displayName}>
          <input
            id="organization-display-name"
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
  );
}
