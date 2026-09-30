import { useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { SignInRequired } from "../auth/SignInRequired";
import { readErrorFields } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createOrganization } from "../lib/organizations-api";
import { organizationPath } from "../lib/organization-routes";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/**
 * Organization creation (REQ-2-1-2). The identifier must use the REQ-1 username
 * format and be globally unique; the display name only has to be non-empty after
 * trimming. A rejected submission keeps the typed values and shows the reason on
 * the matching field without creating anything.
 */
export function NewOrganizationPage() {
  const { status, account } = useAuth();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <main aria-busy={status === "loading" ? true : undefined}>
      <h1>New organization</h1>
      {status === "loading" ? (
        <p role="status">Loading your session…</p>
      ) : !account ? (
        <SignInRequired />
      ) : (
        <form
          className="organization-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setErrors({});
            try {
              const organization = await createOrganization({ name, displayName });
              // The new organization overview is the destination of REQ-2-1-2.
              navigate(organizationPath(organization.login));
            } catch (error) {
              setErrors(readErrorFields(error));
            } finally {
              setBusy(false);
            }
          }}
        >
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
      )}
    </main>
  );
}
