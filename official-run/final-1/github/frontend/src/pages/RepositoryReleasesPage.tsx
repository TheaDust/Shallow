import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryReleases } from "../lib/org-api";
import { repositoryNewReleaseHash, repositoryReleaseHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Repository Releases (REQ-4-5): the released tags of one repository, each
 * linking to its own release detail. A user with Write, Maintain, Admin or
 * organization Owner permission additionally gets the `New release` entry; a
 * visitor reads the same list and details without being offered publication.
 */
export function RepositoryReleasesPage({ owner, name }: { owner: string; name: string }) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryReleases(owner, name),
    [owner, name],
  );
  const view = data;

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-releases">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        <h1 className="repository-releases__title">Releases</h1>
        {status === "loading" && !view ? <LoadingNote label="Loading releases…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {view ? (
          <>
            {view.canWrite ? (
              <p className="repository-releases__new">
                <a
                  className="ui-button ui-button--primary"
                  href={repositoryNewReleaseHash(owner, name)}
                >
                  New release
                </a>
              </p>
            ) : null}
            {view.releases.length === 0 ? (
              <p className="repository-releases__empty">No releases published yet.</p>
            ) : (
              <ul className="release-list">
                {view.releases.map((release) => (
                  <li key={release.id} className="release-row">
                    <a
                      className="release-row__tag"
                      href={repositoryReleaseHash(owner, name, release.tagName)}
                    >
                      {release.tagName}
                    </a>
                    <span className="release-row__title">{release.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
