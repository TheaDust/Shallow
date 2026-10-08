import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { fetchRepositoryRelease } from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";

/**
 * Detail of one published release (REQ-4-5), addressed by its exact tag. The
 * view is read-only and readable by any visitor of the repository: the stored
 * tag, title, description and target branch are the same record the Releases
 * list and the publishing form wrote, so a reload shows the identical values.
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
        {status === "loading" ? <LoadingNote label="Loading release…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {data ? (
          <>
            <h1 className="repository-release__title">{data.release.title}</h1>
            <dl className="repository-release__facts">
              <dt>Tag name</dt>
              <dd className="repository-release__tag">{data.release.tagName}</dd>
              <dt>Target branch</dt>
              <dd className="repository-release__branch">{data.release.targetBranch}</dd>
            </dl>
            {data.release.description ? (
              <p className="repository-release__description">{data.release.description}</p>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
