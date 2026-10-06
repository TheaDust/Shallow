import { AppHeader } from "../components/AppHeader";
import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchPublicOrganizations, fetchReadableRepositories } from "../lib/org-api";
import { organizationHash, repositoryHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/** Signed-out home page: the visitor entry to public organizations and repositories. */
export function HomePage() {
  const { status, data, error, reload } = useAsyncData(() => fetchPublicOrganizations(), []);
  const repositories = useAsyncData(() => fetchReadableRepositories(), []);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body home">
        <h1 className="home__title">GitHub</h1>
        <p className="home__lead">Collaborate on code, issues, and pull requests.</p>
        <nav className="home__actions" aria-label="Get started">
          <a className="ui-button ui-button--primary" href="#/sign-up">
            Sign up
          </a>
          <a className="ui-button" href="#/sign-in">
            Sign in
          </a>
          <a className="ui-button ui-button--ghost" href="#/forgot-password">
            Forgot password
          </a>
        </nav>
      </section>
      <section className="page__body home__organizations" aria-label="Public organizations">
        <h2 className="home__section-title">Public organizations</h2>
        {status === "loading" ? <LoadingNote label="Loading organizations…" /> : null}
        {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
        {status === "ready" && data ? (
          data.length === 0 ? (
            <p className="home__empty">No public organizations yet.</p>
          ) : (
            <ul className="organization-list">
              {data.map((organization) => (
                <li key={organization.id} className="organization-list__item">
                  <a className="organization-list__name" href={organizationHash(organization.id)}>
                    {organization.displayName}
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
      <section className="page__body home__repositories" aria-label="Repositories">
        <h2 className="home__section-title">Repositories</h2>
        {repositories.status === "loading" ? <LoadingNote label="Loading repositories…" /> : null}
        {repositories.status === "error" && repositories.error ? (
          <ErrorNote error={repositories.error} onRetry={repositories.reload} />
        ) : null}
        {repositories.status === "ready" && repositories.data ? (
          repositories.data.length === 0 ? (
            <p className="home__empty">No public repositories yet.</p>
          ) : (
            <ul className="repository-list" aria-label="Repositories">
              {repositories.data.map((repository) => (
                <li key={repository.id} className="repository-list__item">
                  <div className="repository-list__head">
                    <a
                      className="repository-list__name"
                      href={repositoryHash(repository.owner.id, repository.name)}
                    >
                      {repository.name}
                    </a>
                    <span className="repository-list__owner">{repository.owner.displayName}</span>
                  </div>
                  {repository.description ? (
                    <p className="repository-list__description">{repository.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </main>
  );
}
