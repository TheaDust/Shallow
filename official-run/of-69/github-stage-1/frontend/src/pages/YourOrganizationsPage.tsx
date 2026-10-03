import { AppHeader } from "../components/AppHeader";
import { fetchMyOrganizations } from "../lib/organization-api";
import { organizationUrl } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { useAsyncData } from "../lib/use-async-data";

/**
 * “Your organizations”: the list of organizations the signed-in account
 * belongs to, plus the entry that starts a new organization.
 */
export function YourOrganizationsPage({ account }: { account: Account }) {
  const organizations = useAsyncData(fetchMyOrganizations, [account.id]);

  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>Your organizations</h1>
        <p className="page-hint">
          <a href="#/organizations/new">New organization</a>
        </p>
        {organizations.loading ? (
          <p role="status">Loading organizations…</p>
        ) : organizations.error ? (
          <p role="alert">{organizations.error}</p>
        ) : organizations.data && organizations.data.length > 0 ? (
          <ul className="organization-list">
            {organizations.data.map((organization) => (
              <li key={organization.name}>
                <a href={organizationUrl(organization.name)}>{organization.displayName}</a>
                <span className="organization-list__role">{organization.role === "owner" ? "Owner" : "Member"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>You do not belong to any organizations yet.</p>
        )}
      </main>
    </div>
  );
}
