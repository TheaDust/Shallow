import { useEffect, useState } from 'react';
import { apiOrganizations } from '../api';
import { useSession } from '../session';
import { useRedirectTo } from '../router';
import type { OrganizationSummary } from '../types';

/**
 * "Your organizations" (REQ-2 entry from the account menu). Lists the
 * organizations the signed-in account belongs to. Each entry's primary link
 * is the display name (e.g. "Acme Demo"); the organization identifier
 * (e.g. "acme-demo") stays visible as a second link to the same overview
 * page, satisfying the identifier-as-visible-text contract (REQ-2-2-3) while
 * keeping the identifier-named link (REQ-2-1-1). Unauthenticated visitors
 * are redirected to sign-in.
 */
export default function YourOrganizationsPage() {
  const { auth } = useSession();
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);

  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (needsAuth) {
      return;
    }
    let cancelled = false;
    setLoadError(false);
    setOrganizations(null);
    apiOrganizations().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setOrganizations(result.organizations);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsAuth]);

  if (needsAuth) {
    return null;
  }

  return (
    <div className="organizations-page">
      <h1>Your organizations</h1>
      <a className="new-organization-link" href="#/new-organization">
        New organization
      </a>
      {loadError ? (
        <p role="alert" className="form-error">
          Organizations could not be loaded.
        </p>
      ) : organizations === null ? (
        <p className="loading">Loading…</p>
      ) : organizations.length === 0 ? (
        <p className="muted-text">You are not a member of any organization yet.</p>
      ) : (
        <ul className="organization-list">
          {organizations.map((organization) => (
            <li key={organization.name} className="organization-list-item">
              <a
                className="organization-name-link"
                href={`#/organizations/${encodeURIComponent(organization.name)}`}
              >
                {organization.displayName}
              </a>
              <a
                className="organization-id-link"
                href={`#/organizations/${encodeURIComponent(organization.name)}`}
              >
                {organization.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
