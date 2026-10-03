import { canWriteRepositoryRole, fetchRepositoryFile } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { BranchSelector } from "../../components/BranchSelector";
import { CodeBreadcrumb } from "../../components/CodeBreadcrumb";
import { RepositoryNav } from "../../components/RepositoryNav";
import { RepositorySearchBox } from "../../components/RepositorySearchBox";
import { SiteHeader } from "../../components/SiteHeader";
import { navigate } from "../../lib/hash-route";
import { fileNameOf, treePath } from "../../lib/repository-paths";
import { useAsyncData } from "../../lib/useAsyncData";

/**
 * Read-only file page of one branch (REQ-4-1). It shows the stored file name,
 * its path, the branch it was read from and the stored content, and its
 * breadcrumb keeps an exact link to the file itself so a reload shows the same
 * repository context. The branch selector (REQ-4-3-1) switches the snapshot and
 * the “Commits” link opens this file’s own history (REQ-4-4); nothing here
 * writes.
 */
export function RepositoryFilePage({
  ownerLogin,
  repositoryName,
  branch,
  path,
}: {
  ownerLogin: string;
  repositoryName: string;
  branch: string;
  path: string;
}) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => fetchRepositoryFile(ownerLogin, repositoryName, branch, path),
    [ownerLogin, repositoryName, branch, path],
  );
  const repository = data?.repository ?? null;
  const ownerName = repository?.owner?.displayName ?? ownerLogin;
  const fileName = fileNameOf(data?.path ?? path);
  const canWrite = canWriteRepositoryRole(repository?.role);

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <CodeBreadcrumb
        ownerLogin={ownerLogin}
        ownerName={ownerName}
        repositoryName={repositoryName}
        branch={branch}
        path={data?.path ?? path}
        kind="file"
      />
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !error ? (
        <>
          <h1>{fileName}</h1>
          <BranchSelector
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            currentBranch={data.branch}
            canCreate={canWrite}
            onSelect={(name) => navigate(treePath(ownerLogin, repositoryName, name))}
          />
          <p className="file-path">{`Path ${data.path}`}</p>
          <RepositoryNav
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            branch={data.branch}
            active="code"
            path={data.path}
          />
          <RepositorySearchBox ownerLogin={ownerLogin} repositoryName={repositoryName} />
          <pre className="file-content">{data.content}</pre>
        </>
      ) : null}
    </main>
  );
}
