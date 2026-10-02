import { useEffect, useState } from "react";

import { useSession } from "../lib/session";
import { fetchMyOrganizations, type OrganizationSummary } from "../features/organizations/org-api";
import { OrganizationLink } from "../features/organizations/OrganizationLink";

/**
 * "Your organizations" page (REQ-2-1-2): the account-menu destination that
 * lists the organizations the signed-in account belongs to and links to the
 * organization-creation page.
 */
export function OrganizationsPage() {
  const { user, loading } = useSession();
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);

  useEffect(() => {
    if (!user) {
      setOrganizations(null);
      return undefined;
    }
    let active = true;
    fetchMyOrganizations()
      .then((result) => {
        if (active) setOrganizations(result);
      })
      .catch(() => {
        if (active) setOrganizations([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <main className="organizations-page">
      <h1>Your organizations</h1>
      {loading ? <p role="status">Loading your organizations…</p> : null}
      {!loading && !user ? (
        <p className="organizations-page__signed-out">
          You need to sign in to see your organizations. <a href="#/sign-in">Sign in</a>
        </p>
      ) : null}
      {user ? (
        <>
          <p className="organizations-page__create">
            <a href="#/organizations/new">New organization</a>
          </p>
          {organizations === null ? (
            <p role="status">Loading your organizations…</p>
          ) : organizations.length === 0 ? (
            <p className="organizations-page__empty">You do not belong to any organization yet.</p>
          ) : (
            <ul className="organizations-page__list">
              {organizations.map((organization) => (
                <li
                  key={organization.name}
                  className="organizations-page__item"
                  aria-label={`${organization.displayName} ${organization.name}`}
                >
                  <OrganizationLink organization={organization} />
                  {organization.role ? (
                    <span className="organizations-page__role">{organization.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}
