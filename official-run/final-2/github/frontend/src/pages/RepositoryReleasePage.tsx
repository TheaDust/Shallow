import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { formatTimestamp } from "../lib/format";
import { fetchRepositoryRelease } from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * One published release (REQ-4-5): the stored tag, title, description and the
 * branch the release targets. The same record is read after a reload, so the
 * detail and the list can never disagree about a published tag. A visitor of a
 * public repository reads it without signing in and gets no publishing control.
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
  const release = data?.release ?? null;

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-release">
        {data ? <RepositoryBreadcrumb repository={data.repository} /> : null}
        {status === "loading" && !release ? <LoadingNote label="Loading release…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {release ? (
          <>
            <h1 className="repository-release__title">{release.title || release.tag}</h1>
            <p className="repository-release__back">
              <a href={repositoryReleasesHash(owner, name)}>Releases</a>
            </p>
            <dl className="repository-release__facts">
              <dt>Tag name</dt>
              <dd>{release.tag}</dd>
              <dt>Target branch</dt>
              <dd>{release.targetBranch}</dd>
              <dt>Published</dt>
              <dd>{formatTimestamp(release.publishedAt)}</dd>
              <dt>Author</dt>
              <dd>{release.author}</dd>
            </dl>
            <section className="repository-release__description" aria-label="Description">
              <h2 className="repository-release__description-title">Description</h2>
              <p className="repository-release__description-body">{release.description}</p>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
