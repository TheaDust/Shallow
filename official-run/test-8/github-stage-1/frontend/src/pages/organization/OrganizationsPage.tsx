import { fetchYourOrganizations, fetchYourRepositories } from "../../api/organizations";
import type { Account } from "../../api/auth";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";

/**
 * “Your organizations”: the signed-in workspace reached from the account menu.
 *
 * It lists the organizations the account belongs to and the repositories the
 * account may read. Listing repositories here (not only inside an organization)
 * keeps a repository available to an account that holds a direct grant or reads
 * a public repository without being an organization member.
 */
export function OrganizationsPage({ account }: { account: Account }) {
  const organizations = useAsyncData(() => fetchYourOrganizations(), []);
  const repositories = useAsyncData(() => fetchYourRepositories(), []);

  return (
    <main>
      <SiteHeader account={account} />
      <h1>Your organizations</h1>
      <p>
        <a href={makeHash("/organizations/new")}>New organization</a>
      </p>
      {organizations.loading ? <p role="status">Loading…</p> : null}
      {organizations.error ? (
        <p className="form-error" role="alert">
          {organizations.error}
        </p>
      ) : null}
      {organizations.data ? (
        organizations.data.organizations.length > 0 ? (
          <ul className="organization-list">
            {organizations.data.organizations.map((organization) => (
              <li key={organization.id}>
                <a href={makeHash(`/organizations/${organization.slug}`)}>{organization.displayName}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p>You are not a member of any organization yet.</p>
        )
      ) : null}
      {repositories.error ? (
        <p className="form-error" role="alert">
          {repositories.error}
        </p>
      ) : null}
      {repositories.data && repositories.data.repositories.length > 0 ? (
        <section className="organization-repositories" aria-labelledby="your-repositories-heading">
          <h2 id="your-repositories-heading">Repositories</h2>
          <ul className="repository-list">
            {repositories.data.repositories.map((repository) => (
              <li key={repository.id} className="repository-list__item">
                <a
                  className="repository-list__link"
                  href={makeHash(`/repositories/${repository.organization?.slug}/${repository.name}`)}
                >
                  {repository.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
