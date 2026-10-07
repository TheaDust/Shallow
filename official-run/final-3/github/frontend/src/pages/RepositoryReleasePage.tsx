import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryRelease } from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Release detail (REQ-4-5). It displays the exact tag, the release title, the
 * description and the target branch of the persisted release, all read from the
 * same stored record the list uses, so a reload shows the same detail. Visitors
 * with repository-view permission read it without signing in.
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
  const release = data?.release;

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-release">
        {data ? <RepositoryBreadcrumb repository={data.repository} /> : null}
        {status === "loading" && !data ? <LoadingNote label="Loading release…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {release ? (
          <article className="release">
            <h1 className="release__title">{release.title}</h1>
            <p className="release__tag">{release.tag}</p>
            {release.description ? <p className="release__description">{release.description}</p> : null}
            <dl className="release__facts">
              <dt>Target branch</dt>
              <dd>{release.targetBranch}</dd>
            </dl>
            <p className="release__back">
              <a href={repositoryReleasesHash(owner, name)}>Releases</a>
            </p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
