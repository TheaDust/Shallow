import { useEffect, useState } from "react";

import { messageOf } from "../../lib/session-api";
import { listMyOrganizations, type OrganizationMembership } from "../../lib/organizations-api";
import { ProtectedPage } from "../account/ProtectedPage";
import { roleLabel } from "./format";

/**
 * The page opened by the account-menu link "Your organizations". It is only
 * mounted with a session, so it can read the signed-in account's memberships.
 */
function OrganizationList() {
  const [organizations, setOrganizations] = useState<OrganizationMembership[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyOrganizations()
      .then((list) => {
        if (!cancelled) setOrganizations(list);
      })
      .catch((error) => {
        if (!cancelled) setFailure(messageOf(error, "Unable to load your organizations."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="organization-list">
      <p>
        <a href="#/organizations/new">New organization</a>
      </p>
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
      {organizations === null && !failure ? <p role="status">Loading…</p> : null}
      {organizations !== null && organizations.length === 0 ? (
        <p>You are not a member of any organization yet.</p>
      ) : null}
      {organizations !== null && organizations.length > 0 ? (
        <ul className="organization-list__items">
          {organizations.map((organization) => (
            <li key={organization.name} className="organization-list__item">
              <a href={`#/organizations/${organization.name}`}>{organization.name}</a>
              <span className="organization-list__role">{roleLabel(organization.role)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function OrganizationListPage() {
  return (
    <ProtectedPage title="Your organizations">
      <OrganizationList />
    </ProtectedPage>
  );
}
