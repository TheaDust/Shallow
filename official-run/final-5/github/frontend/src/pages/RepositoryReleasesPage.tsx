import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryReleases } from "../lib/org-api";
import { repositoryNewReleaseHash, repositoryReleaseHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Repository Releases page (REQ-4-5). The list reads the published releases of
 * the repository and stays readable to any visitor; the "New release" entry is
 * only offered to a caller with the publish permission. Each row links to its
 * release detail by the exact tag, which is the repository-scoped identifier.
 */
export function RepositoryReleasesPage({ owner, name }: { owner: string; name: string }) {
  const { status, data, error } = useAsyncData(() => fetchRepositoryReleases(owner, name), [owner, name]);

  return (
    <main className="page">
      <section className="page__body repository-releases">
        {data ? <RepositoryBreadcrumb repository={data.repository} /> : null}
        <h1 className="repository-releases__title">Releases</h1>
        {status === "loading" ? <LoadingNote label="Loading releases…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {data ? (
          <>
            {data.canWrite ? (
              <p className="repository-releases__actions">
                <a
                  className="ui-button ui-button--primary"
                  href={repositoryNewReleaseHash(data.repository.owner.id, data.repository.name)}
                >
                  New release
                </a>
              </p>
            ) : null}
            {data.releases.length === 0 ? (
              <p className="repository-releases__empty">No releases published yet.</p>
            ) : (
              <ul className="repository-releases__list" aria-label="Releases">
                {data.releases.map((release) => (
                  <li key={release.id} className="repository-releases__item">
                    <a
                      className="repository-releases__tag"
                      href={repositoryReleaseHash(
                        data.repository.owner.id,
                        data.repository.name,
                        release.tagName,
                      )}
                    >
                      {release.tagName}
                    </a>
                    <span className="repository-releases__name">{release.title}</span>
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
