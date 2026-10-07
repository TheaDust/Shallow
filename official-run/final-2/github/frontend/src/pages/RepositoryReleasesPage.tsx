import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryReleases } from "../lib/org-api";
import { repositoryNewReleaseHash, repositoryReleaseHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Releases list of one repository (REQ-4-5). The published tags come from the
 * stored release records, so the list, the detail page and a reload all read
 * the same repository-scoped tag. The `New release` control is the publishing
 * entry and is only offered to a Write, Maintain, Admin or organization Owner
 * caller; the server re-checks that rule on every publish.
 */
export function RepositoryReleasesPage({ owner, name }: { owner: string; name: string }) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryReleases(owner, name),
    [owner, name],
  );

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
              <p className="repository-releases__empty">No releases published.</p>
            ) : (
              <ul className="release-list">
                {data.releases.map((release) => (
                  <li key={release.id} className="release-row">
                    <h2 className="release-row__tag">
                      <a
                        className="release-row__link"
                        href={repositoryReleaseHash(owner, name, release.tag)}
                      >
                        {release.tag}
                      </a>
                    </h2>
                    <p className="release-row__title">{release.title}</p>
                    <p className="release-row__branch">Target branch: {release.targetBranch}</p>
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
