import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiCreateOrganization } from '../api';
import { navigate, useRedirectTo } from '../router';
import { useSession } from '../session';
import type { CreateOrganizationErrors } from '../types';

/**
 * REQ-2-1-2 organization-creation page, opened by the "New organization" link
 * on "Your organizations". The fields are labeled "Organization name" and
 * "Display name"; the submit button is "Create organization". Server-side
 * field errors are shown next to the corresponding input and non-sensitive
 * input is retained; on success the user is redirected to the new
 * organization's overview page (heading = organization identifier).
 */
export default function CreateOrganizationPage() {
  const { auth } = useSession();
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);

  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<CreateOrganizationErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const result = await apiCreateOrganization({ name, displayName });
      if (result.ok) {
        navigate(`#/organizations/${encodeURIComponent(result.organization.name)}`);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (needsAuth) {
    return null;
  }

  return (
    <div className="account-access-page create-organization-page">
      <h1>Create new organization</h1>
      <form className="account-access-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="organization-name">Organization name</label>
          <input
            id="organization-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={errors.name ? 'organization-name-error' : undefined}
            aria-invalid={errors.name ? true : undefined}
          />
          {errors.name ? (
            <p id="organization-name-error" className="field-error">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="organization-display-name">Display name</label>
          <input
            id="organization-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-describedby={errors.displayName ? 'organization-display-name-error' : undefined}
            aria-invalid={errors.displayName ? true : undefined}
          />
          {errors.displayName ? (
            <p id="organization-display-name-error" className="field-error">
              {errors.displayName}
            </p>
          ) : null}
        </div>

        <button type="submit" className="primary-button" disabled={submitting}>
          Create organization
        </button>
      </form>
    </div>
  );
}
