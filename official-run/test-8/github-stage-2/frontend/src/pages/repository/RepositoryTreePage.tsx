import { canWriteRepositoryRole, fetchRepositoryTree } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { AddFileMenu } from "../../components/AddFileMenu";
import { BranchSelector } from "../../components/BranchSelector";
import { CodeBreadcrumb } from "../../components/CodeBreadcrumb";
import { CodeEntryList } from "../../components/CodeEntryList";
import { RepositoryNav } from "../../components/RepositoryNav";
import { RepositorySearchBox } from "../../components/RepositorySearchBox";
import { SiteHeader } from "../../components/SiteHeader";
import { navigate } from "../../lib/hash-route";
import { treePath } from "../../lib/repository-paths";
import { useAsyncData } from "../../lib/useAsyncData";

/**
 * One directory of a branch (REQ-4-1). The breadcrumb identifies the current
 * path and every nested name is a directory link, so the directory hierarchy of
 * the selected branch can be walked without changing repository data.
 */
export function RepositoryTreePage({
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
    () => fetchRepositoryTree(ownerLogin, repositoryName, branch, path),
    [ownerLogin, repositoryName, branch, path],
  );
  const repository = data?.repository ?? null;
  const ownerName = repository?.owner?.displayName ?? ownerLogin;
  const currentPath = data?.path ?? path;
  const entries = data?.entries ?? [];
  const canWrite = canWriteRepositoryRole(repository?.role);

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <CodeBreadcrumb
        ownerLogin={ownerLogin}
        ownerName={ownerName}
        repositoryName={repositoryName}
        branch={branch}
        path={currentPath}
        kind="directory"
      />
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {data && !error ? (
        <>
          <RepositoryNav
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            branch={data.branch}
            active="code"
          />
          <RepositorySearchBox
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
          />
          <h1 className="code-heading">{currentPath || repositoryName}</h1>
          <BranchSelector
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            currentBranch={data.branch}
            canCreate={canWrite}
            onSelect={(name) => navigate(treePath(ownerLogin, repositoryName, name))}
          />
          {canWrite ? (
            <AddFileMenu ownerLogin={ownerLogin} repositoryName={repositoryName} branch={data.branch} />
          ) : null}
          <CodeEntryList
            ownerLogin={ownerLogin}
            repositoryName={repositoryName}
            branch={data.branch}
            entries={entries}
          />
        </>
      ) : null}
    </main>
  );
}
