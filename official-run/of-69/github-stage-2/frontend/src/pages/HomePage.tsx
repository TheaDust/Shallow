import { AppHeader } from "../components/AppHeader";
import { fetchPublicOrganizations, fetchReadableRepositories } from "../lib/organization-api";
import { organizationUrl, repositoryUrl } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

/**
 * Public home page. The top bar carries the global “Search” control; the
 * repository entries below name every repository the visitor may read, so a
 * public repository can be opened without signing in.
 */
export function HomePage() {
  const { account } = useSession();
  const organizations = useAsyncData(fetchPublicOrganizations, []);
  const repositories = useAsyncData(fetchReadableRepositories, []);

  return (
    <div className="app-shell">
      <AppHeader username={account?.username} />
      <main>
        <h1>GitHub</h1>
        <p className="home-tagline">A simplified collaboration platform for repositories and teams.</p>
        <nav className="home-links" aria-label="Account access">
          <a href="#/signup">Sign up</a>
          <a href="#/signin">Sign in</a>
          <a href="#/recover">Forgot password</a>
        </nav>
        <section className="home-repositories" aria-labelledby="home-repositories-heading">
          <h2 id="home-repositories-heading">Explore repositories</h2>
          {repositories.loading ? (
            <p role="status">Loading repositories…</p>
          ) : repositories.data && repositories.data.length > 0 ? (
            <ul className="repository-list">
              {repositories.data.map((repository) => (
                <li key={`${repository.owner.type ?? "organization"}:${repository.owner.name}/${repository.name}`} className="repository-list__item">
                  <a href={repositoryUrl(repository.owner, repository.name)}>{repository.name}</a>
                  <span className="repository-list__visibility" data-visibility={repository.visibility}>
                    {repository.visibility === "public" ? "Public" : "Private"}
                  </span>
                  <p className="repository-list__owner">
                    {repository.owner.displayName}/{repository.name}
                  </p>
                  <p className="repository-list__description">{repository.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No public repositories yet.</p>
          )}
        </section>
        <section className="home-organizations" aria-labelledby="home-organizations-heading">
          <h2 id="home-organizations-heading">Explore organizations</h2>
          {organizations.loading ? (
            <p role="status">Loading organizations…</p>
          ) : organizations.data && organizations.data.length > 0 ? (
            <ul className="organization-list">
              {organizations.data.map((organization) => (
                <li key={organization.name}>
                  <a href={organizationUrl(organization.name)}>{organization.displayName}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No public organizations yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}
