import { AppHeader } from "../components/AppHeader";
import { ErrorNote, LoadingNote } from "../components/ViewState";
import { fetchReadableRepositories, fetchYourOrganizations } from "../lib/org-api";
import { newRepositoryHash, organizationHash, repositoryHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/** Signed-in entry point: the organizations and repositories this identity can use. */
export function WorkspacePage() {
  const organizations = useAsyncData(() => fetchYourOrganizations(), []);
  const repositories = useAsyncData(() => fetchReadableRepositories(), []);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body workspace">
        <h1 className="workspace__title">Workspace</h1>
        <p className="workspace__lead">Your account is signed in for this browser session.</p>
      </section>
      <section className="page__body workspace__organizations" aria-label="Your organizations">
        <h2 className="workspace__section-title">Your organizations</h2>
        {organizations.status === "loading" ? <LoadingNote label="Loading organizations…" /> : null}
        {organizations.status === "error" && organizations.error ? (
          <ErrorNote error={organizations.error} onRetry={organizations.reload} />
        ) : null}
        {organizations.status === "ready" && organizations.data ? (
          organizations.data.length === 0 ? (
            <p className="workspace__empty">You do not belong to any organizations yet.</p>
          ) : (
            <ul className="organization-list" aria-label="Your organizations">
              {organizations.data.map((organization) => (
                <li key={organization.id} className="organization-list__item">
                  <a className="organization-list__name" href={organizationHash(organization.id)}>
                    {organization.displayName}
                  </a>
                  {organization.role ? (
                    <span className="organization-list__role">{organization.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
      <section className="page__body workspace__repositories" aria-label="Repositories you can read">
        <h2 className="workspace__section-title">Repositories</h2>
        <p className="workspace__actions">
          <a className="ui-button ui-button--primary" href={newRepositoryHash}>
            New repository
          </a>
        </p>
        {repositories.status === "loading" ? <LoadingNote label="Loading repositories…" /> : null}
        {repositories.status === "error" && repositories.error ? (
          <ErrorNote error={repositories.error} onRetry={repositories.reload} />
        ) : null}
        {repositories.status === "ready" && repositories.data ? (
          repositories.data.length === 0 ? (
            <p className="workspace__empty">No repositories are visible to this account yet.</p>
          ) : (
            <ul className="repository-list" aria-label="Repositories you can read">
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
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </main>
  );
}
