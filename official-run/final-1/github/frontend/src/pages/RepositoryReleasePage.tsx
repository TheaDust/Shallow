import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryRelease } from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * One published release (REQ-4-5): the stored tag, its title, its description
 * and the branch it targets. The publication itself links back to the list, and
 * reloading the address reads the same stored release.
 */
export function RepositoryReleasePage({
  owner,
  name,
  tag,
}: {
  owner: string;
  name: string;
  tag: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryRelease(owner, name, tag),
    [owner, name, tag],
  );
  const view = data;

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-release">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        {status === "loading" && !view ? <LoadingNote label="Loading release…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {view ? (
          <>
            <p className="repository-release__back">
              <a href={repositoryReleasesHash(owner, name)}>Releases</a>
            </p>
            <h1 className="repository-release__title">{view.release.title}</h1>
            <h2 className="repository-release__tag">{view.release.tagName}</h2>
            {view.release.description ? (
              <p className="repository-release__description">{view.release.description}</p>
            ) : null}
            <dl className="repository__facts">
              <dt>Target branch</dt>
              <dd>{view.release.targetBranch}</dd>
              <dt>Author</dt>
              <dd>{view.release.author}</dd>
            </dl>
          </>
        ) : null}
      </section>
    </main>
  );
}
