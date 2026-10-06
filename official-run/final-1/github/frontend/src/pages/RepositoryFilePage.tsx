import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { useBranchAddress } from "../lib/branch-address";
import { fetchRepositoryFile } from "../lib/org-api";
import { repositoryCommitsHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";

/**
 * Read-only file view: the stored file name, its path, the branch it was read
 * from and the readable content. The breadcrumb ends in a link to the file
 * itself, so the stored name stays linkable after a reload. Opening and
 * reloading the page never changes repository data.
 */
export function RepositoryFilePage({
  owner,
  name,
  path,
  branch = "",
}: {
  owner: string;
  name: string;
  path: string;
  branch?: string;
}) {
  const { status, data, error } = useAsyncData(
    () => fetchRepositoryFile(owner, name, path, branch),
    [owner, name, path, branch],
  );
  useBranchAddress(data?.file.branch);

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-file">
        {status === "loading" ? <LoadingNote label="Loading file…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? (
          <>
            <RepositoryBreadcrumb
              repository={data.repository}
              path={data.file.path}
              file
              branch={data.file.branch === data.file.defaultBranch ? undefined : data.file.branch}
            />
            <h1 className="repository__title">{data.file.name}</h1>
            <dl className="repository__facts">
              <dt>Path</dt>
              <dd>{data.file.path}</dd>
              <dt>Branch</dt>
              <dd>{data.file.branch}</dd>
            </dl>
            <pre className="repository-file__content">{data.file.content}</pre>
            <p className="repository-file__commits">
              <a
                href={repositoryCommitsHash(
                  data.repository.owner.id,
                  data.repository.name,
                  data.file.path,
                  data.file.branch === data.file.defaultBranch ? undefined : data.file.branch,
                )}
              >
                Commits
              </a>
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
