import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { listOrganizations, OrganizationSummary } from "../../lib/org-api";
import { useSession } from "../../session";

/**
 * “Your organizations”: the account-menu destination listing organizations the
 * current account belongs to, with the “New organization” entry.
 */
export function OrganizationsPage() {
  const { status } = useSession();
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    listOrganizations()
      .then((result) => {
        if (!cancelled) setOrganizations(result);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load organizations.");
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

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
          <h1>Your organizations</h1>
          <p>Sign in to access your organizations.</p>
          <a href="#/signin">Sign in</a>
        </main>
      </AppHeader>
    );
  }

  return (
    <AppHeader>
      <main>
        <h1>Your organizations</h1>
        <p>
          <a href="#/orgs/new">New organization</a>
        </p>
        {error && <p className="account-form__error">{error}</p>}
        {organizations === null ? (
          <p>Loading…</p>
        ) : organizations.length === 0 ? (
          <p>You are not a member of any organization yet.</p>
        ) : (
          <ul className="org-list">
            {organizations.map((organization) => (
              <li key={organization.name} className="org-list__item">
                {/* The entry is announced by the display name while the identifier
                    stays visible as the link text and in the destination URL. */}
                <a
                  href={`#/o/${encodeURIComponent(organization.name)}`}
                  aria-label={organization.displayName}
                >
                  {organization.name}
                </a>
                <span className="org-list__meta">
                  {organization.displayName} · {organization.role === "owner" ? "Owner" : "Member"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppHeader>
  );
}
