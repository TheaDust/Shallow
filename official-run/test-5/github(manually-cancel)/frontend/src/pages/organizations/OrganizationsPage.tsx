import { fetchMyOrganizations, organizationHash } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { useSession } from "../../session/SessionProvider";
import { AuthenticationRequired, BusyMain } from "../common";

/**
 * REQ-2-1-1 / REQ-2-1-2: the “Your organizations” page reached from the account
 * menu. It lists the organizations the signed-in account belongs to and offers
 * the “New organization” link.
 */
export function OrganizationsPage() {
  const { status, account } = useSession();
  const organizations = useAsyncData(
    () => (account ? fetchMyOrganizations() : Promise.resolve([])),
    [account?.username ?? null],
  );

  if (status === "loading") return <BusyMain />;
  if (!account) return <AuthenticationRequired />;

  return (
    <main>
      <h1>Your organizations</h1>
      <p>
        <a href="#/organizations/new">New organization</a>
      </p>
      {organizations.status === "loading" ? <p role="status">Loading organizations…</p> : null}
      {organizations.status === "error" ? (
        <p role="status">Unable to load your organizations.</p>
      ) : null}
      {organizations.status === "ready" ? (
        organizations.data && organizations.data.length > 0 ? (
          <ul className="organization-list">
            {organizations.data.map((organization) => (
              <li key={organization.name}>
                <a href={organizationHash(organization.name)}>{organization.name}</a>
                {organization.role ? (
                  <span className="organization-list__role">
                    {organization.role === "owner" ? "Owner" : "Member"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>You do not belong to any organization yet.</p>
        )
      ) : null}
    </main>
  );
}
