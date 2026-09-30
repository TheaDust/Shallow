import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { SignInRequired } from "../auth/SignInRequired";
import { fetchViewerOrganizations, type OrganizationSummary } from "../lib/organizations-api";
import { newOrganizationHref, organizationHref } from "../lib/organization-routes";

/**
 * "Your organizations" (REQ-2-1-2): the list of organizations the current
 * account belongs to, with the identifier as visible text, plus the
 * "New organization" entry that opens the creation form.
 */
export function YourOrganizationsPage() {
  const { status, account } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!account) {
      setOrganizations(null);
      return;
    }
    let active = true;
    setOrganizations(null);
    setFailed(false);
    fetchViewerOrganizations()
      .then((results) => {
        if (active) setOrganizations(results);
      })
      .catch(() => {
        if (!active) return;
        setOrganizations([]);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [account]);

  return (
    <main aria-busy={status === "loading" ? true : undefined}>
      <h1>Your organizations</h1>
      {status === "loading" ? (
        <p role="status">Loading your session…</p>
      ) : !account ? (
        <SignInRequired />
      ) : (
        <>
          <p>
            <a href={newOrganizationHref()}>New organization</a>
          </p>
          {failed ? (
            <p role="alert">
              Your organizations could not be loaded. Reload the page to try again.
            </p>
          ) : organizations === null ? (
            <p role="status">Loading organizations…</p>
          ) : organizations.length === 0 ? (
            <p>You do not belong to any organization yet.</p>
          ) : (
            <ul className="organization-list">
              {organizations.map((organization) => (
                <li key={organization.id} className="organization-list__item">
                  <article>
                    <h2 className="organization-list__name">
                      <a href={organizationHref(organization.login)}>{organization.login}</a>
                    </h2>
                    <p className="organization-list__display-name">{organization.name}</p>
                    {organization.viewerRole ? (
                      <p className="organization-list__role">
                        {organization.viewerRole === "owner" ? "Owner" : "Member"}
                      </p>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
