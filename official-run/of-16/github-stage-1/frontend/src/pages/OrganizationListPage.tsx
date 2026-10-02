import { useEffect, useState } from "react";

import { fetchMyOrganizations, fetchOrganizationRepositories } from "../organizations/api";
import { organizationRoleLabel } from "../organizations/format";
import type { OrganizationMembership, RepositorySummary } from "../organizations/types";

/**
 * "Your organizations" page of the account menu. It lists every organization
 * the signed-in account belongs to together with the repositories of that
 * organization the account may read, so a repository can be opened from here
 * directly; it also exposes the "New organization" entry. The repository lists
 * come from the same visibility rules as the organization pages and never
 * reveal a repository the account cannot read.
 */
export function OrganizationListPage() {
  const [organizations, setOrganizations] = useState<OrganizationMembership[] | null>(null);
  const [repositories, setRepositories] = useState<Record<string, RepositorySummary[]>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyOrganizations()
      .then(async (next) => {
        if (cancelled) return;
        setOrganizations(next);
        const loaded = await Promise.all(next.map(async (organization) => {
          try {
            return [organization.slug, await fetchOrganizationRepositories(organization.slug)] as const;
          } catch {
            // The organization itself stays listed even when its repository
            // list cannot be read.
            return [organization.slug, [] as RepositorySummary[]] as const;
          }
        }));
        if (!cancelled) setRepositories(Object.fromEntries(loaded));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page">
      <h1>Your organizations</h1>
      <p className="page__lead">
        Organizations you belong to, with the repositories you can read. Open one to browse its
        people and teams.
      </p>
      <p className="page__links">
        <a href="#/organizations/new">New organization</a>
      </p>
      {failed ? (
        <p className="app-form__error" role="alert">
          We could not load your organizations. Try again.
        </p>
      ) : null}
      {!failed && organizations === null ? <p role="status">Loading organizations…</p> : null}
      {organizations !== null ? (
        organizations.length > 0 ? (
          <ul className="organization-list">
            {organizations.map((organization) => (
              <li key={organization.slug} className="organization-list__item">
                <div className="organization-list__heading">
                  <a className="organization-list__name" href={`#/organizations/${organization.slug}`}>
                    {organization.displayName}
                  </a>
                  <span className="organization-list__role">{organizationRoleLabel(organization.role)}</span>
                </div>
                {repositories[organization.slug]?.length ? (
                  <p className="organization-list__repositories">
                    {repositories[organization.slug].map((repository) => (
                      <a
                        key={repository.name}
                        className="organization-list__repository-name"
                        href={`#/organizations/${organization.slug}/repositories/${repository.name}`}
                      >
                        {repository.name}
                      </a>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="organization-list__empty">You are not a member of any organization yet.</p>
        )
      ) : null}
    </section>
  );
}
