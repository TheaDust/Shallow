import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryRelease } from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Release detail of one repository (REQ-4-5). The stored release is read by its
 * repository plus its exact tag, so the detail keeps the tag, the title, the
 * description and the target branch after a reload or a direct link. It is
 * readable with the repository, and offers no publication control.
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

  return (
    <main className="page">
      <section className="page__body repository-release">
        {data ? <RepositoryBreadcrumb repository={data.repository} /> : null}
        {status === "loading" && !data ? <LoadingNote label="Loading release…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {data ? (
          <>
            <h1 className="repository-release__title">{data.release.title}</h1>
            <p className="repository-release__tag">
              <span className="repository-release__tag-value">{data.release.tag}</span>
            </p>
            <p className="repository-release__branch">
              Target branch:{" "}
              <span className="repository-release__branch-name">{data.release.branch}</span>
            </p>
            <p className="repository-release__description">{data.release.description}</p>
            <p className="repository-release__author">Published by {data.release.author}</p>
            <p className="repository-release__back">
              <a href={repositoryReleasesHash(owner, name)}>Releases</a>
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
