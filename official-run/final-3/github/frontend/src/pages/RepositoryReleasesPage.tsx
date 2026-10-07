import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryReleases } from "../lib/org-api";
import { repositoryNewReleaseHash, repositoryReleaseHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Repository Releases page (REQ-4-5). Every visitor with repository-view
 * permission reads the persisted releases of the repository; a writer additionally
 * gets the `New release` entry. Each release link is named by its exact tag and
 * opens the release detail.
 */
export function RepositoryReleasesPage({ owner, name }: { owner: string; name: string }) {
  const { status, data, error } = useAsyncData(() => fetchRepositoryReleases(owner, name), [owner, name]);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-releases">
        {data ? <RepositoryBreadcrumb repository={data.repository} /> : null}
        <h1 className="repository-releases__title">Releases</h1>
        {status === "loading" && !data ? <LoadingNote label="Loading releases…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {data ? (
          <>
            {data.canWrite ? (
              <p className="repository-releases__new">
                <a className="ui-button ui-button--primary" href={repositoryNewReleaseHash(owner, name)}>
                  New release
                </a>
              </p>
            ) : null}
            {data.releases.length === 0 ? (
              <p className="repository-releases__empty">No releases yet.</p>
            ) : (
              <ul className="release-list">
                {data.releases.map((release) => (
                  <li key={release.id} className="release-row">
                    <a
                      className="release-row__tag"
                      href={repositoryReleaseHash(owner, name, release.tag)}
                    >
                      {release.tag}
                    </a>
                    <span className="release-row__title">{release.title}</span>
                    <span className="release-row__branch">{release.targetBranch}</span>
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
