import { useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { navigate } from "../../lib/hash-route";
import { createOrganization, OrganizationFieldErrors } from "../../lib/org-api";
import { useSession } from "../../session";

/**
 * “New organization” form: Organization name (identifier) and Display name,
 * with exact field errors on conflict, malformed identifiers, or a missing
 * display name. Non-sensitive input is retained after a failed submission.
 */
export function NewOrganizationPage() {
  const { status } = useSession();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<OrganizationFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setErrors({});
    setSubmitting(true);
    try {
      const result = await createOrganization({ name, displayName });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      navigate(`/o/${result.organization.name}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <AppHeader>
        <main>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  if (status !== "authenticated") {
    return (
      <AppHeader>
        <main>
          <h1>New organization</h1>
          <p>Sign in to create an organization.</p>
          <a href="#/signin">Sign in</a>
        </main>
      </AppHeader>
    );
  }

  return (
    <AppHeader>
      <main>
        <h1>New organization</h1>
        <form className="account-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="account-form__field">
            <label htmlFor="org-name">Organization name</label>
            <input
              id="org-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={errors.name ? "org-name-error" : undefined}
              autoComplete="off"
            />
            {errors.name && (
              <p className="account-form__error" id="org-name-error">
                {errors.name}
              </p>
            )}
          </div>
          <div className="account-form__field">
            <label htmlFor="org-display-name">Display name</label>
            <input
              id="org-display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-describedby={errors.displayName ? "org-display-name-error" : undefined}
            />
            {errors.displayName && (
              <p className="account-form__error" id="org-display-name-error">
                {errors.displayName}
              </p>
            )}
          </div>
          <button type="submit" className="button button--primary" disabled={submitting}>
            Create organization
          </button>
        </form>
      </main>
    </AppHeader>
  );
}
