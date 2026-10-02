import { useEffect, useState } from "react";

import { useSession } from "../lib/session";
import { fetchPublicOrganizations, type OrganizationSummary } from "../features/organizations/org-api";
import { OrganizationLink } from "../features/organizations/OrganizationLink";
import { RepositoryList } from "../features/repositories/RepositoryList";
import { useReadableRepositories } from "../features/repositories/use-repository";

/**
 * Public home page: the three entries into the account-access page
 * (REQ-1: "Sign up", "Sign in", "Forgot password"), the public organization
 * directory (REQ-2-1) and the repository list, so a repository overview is
 * reachable from a list as well as from search or a direct address (REQ-3).
 */
export function HomePage() {
  const { user } = useSession();
  const repositories = useReadableRepositories(user?.username ?? null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);

  useEffect(() => {
    let active = true;
    fetchPublicOrganizations()
      .then((result) => {
        if (active) setOrganizations(result);
      })
      .catch(() => {
        if (active) setOrganizations([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="home-page">
      <h1>GitHub</h1>
      <p className="home-page__lead">
        A simplified GitHub collaboration platform for people, organizations and repositories.
      </p>
      <nav className="home-page__links">
        <a href="#/register">Sign up</a>
        <a href="#/sign-in">Sign in</a>
        <a href="#/forgot-password">Forgot password</a>
      </nav>
      {user ? (
        <p className="home-page__signed-in">
          You are signed in. Open your <a href="#/workspace">workspace</a>.
        </p>
      ) : null}
      <RepositoryList repositories={repositories} />
      {organizations.length > 0 ? (
        <section className="home-page__organizations" aria-label="Public organizations">
          <h2>Public organizations</h2>
          <ul className="home-page__organization-list">
            {organizations.map((organization) => (
              <li
                key={organization.name}
                className="home-page__organization"
                aria-label={`${organization.displayName} ${organization.name}`}
              >
                <OrganizationLink organization={organization} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
