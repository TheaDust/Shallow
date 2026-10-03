import { canWriteRepositoryRole, fetchRepositoryTree } from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { AddFileMenu } from "../../components/AddFileMenu";
import { BranchSelector } from "../../components/BranchSelector";
import { CloneMenu } from "../../components/CloneMenu";
import { CodeEntryList } from "../../components/CodeEntryList";
import { RepositoryNav } from "../../components/RepositoryNav";
import { RepositorySearchBox } from "../../components/RepositorySearchBox";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash, navigate } from "../../lib/hash-route";
import { repositoryPath, treePath } from "../../lib/repository-paths";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button } from "../../ui";

function formatUpdatedAt(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

const VISIBILITY_LABEL = { public: "Public", private: "Private" } as const;

/**
 * Repository root — the Code page of REQ-4. It keeps the REQ-3-3 overview (the
 * `owner/repository` heading, the visibility marker, default branch, clone-menu
 * “Code” button, “Fork” button and the “Code” navigation link) and adds the
 * browsing snapshot of the current branch: the repository Search box, the branch
 * selector (REQ-4-3-1), the “Add file” entry of REQ-4-4 and the files and
 * directories at the repository root.
 */
export function RepositoryPage({ slug, repositoryName }: { slug: string; repositoryName: string }) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(
    () => fetchRepositoryTree(slug, repositoryName),
    [slug, repositoryName],
  );
  const repository = data?.repository ?? null;
  const owner = repository?.owner ?? null;
  const ownerName = owner?.displayName ?? slug;
  const ownerLogin = owner?.login ?? slug;
  const branch = data?.branch ?? repository?.defaultBranch ?? "main";
  const entries = data?.entries ?? [];
  const canWrite = canWriteRepositoryRole(repository?.role);

  return (
    <main>
      <SiteHeader account={account} showGlobalSearch={false} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {owner?.type === "organization" ? (
          <a className="breadcrumb__link" href={makeHash(`/organizations/${ownerLogin}`)}>
            {ownerName}
          </a>
        ) : (
          <span className="breadcrumb__owner">{ownerName}</span>
        )}
      </nav>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {repository && !error ? (
        <>
          <h1 className="repository-heading">
            {ownerName}/<span className="repository-heading__name">{repository.name}</span>
          </h1>
          {repository.description ? <p className="repository-description">{repository.description}</p> : null}
          <div className="repository-actions">
            <CloneMenu repository={repository} />
            <Button
              onClick={() => navigate(`${repositoryPath(ownerLogin, repository.name)}/fork`)}
            >
              Fork
            </Button>
            {canWrite ? (
              <AddFileMenu
                ownerLogin={ownerLogin}
                repositoryName={repository.name}
                branch={branch}
              />
            ) : null}
          </div>
          <p className="repository-meta">
            <span className="repository-visibility">{VISIBILITY_LABEL[repository.visibility]}</span>
            <span aria-hidden="true"> · </span>
            <span>Default branch {repository.defaultBranch}</span>
            <span aria-hidden="true"> · </span>
            <span>Updated {formatUpdatedAt(repository.updatedAt)}</span>
          </p>
          <RepositoryNav
            ownerLogin={ownerLogin}
            repositoryName={repository.name}
            branch={branch}
            active="code"
          >
            {repository.role === "admin" ? (
              <a
                className="repository-nav__link"
                href={makeHash(`${repositoryPath(ownerLogin, repository.name)}/settings`)}
              >
                Settings
              </a>
            ) : null}
          </RepositoryNav>
          <RepositorySearchBox ownerLogin={ownerLogin} repositoryName={repository.name} />
          <BranchSelector
            ownerLogin={ownerLogin}
            repositoryName={repository.name}
            currentBranch={branch}
            canCreate={canWrite}
            onSelect={(name) => navigate(treePath(ownerLogin, repository.name, name))}
          />
          {repository.forkedFrom ? (
            <p className="repository-fork-source">
              Forked from{" "}
              <a
                href={makeHash(
                  `/repositories/${repository.forkedFrom.owner.login}/${repository.forkedFrom.name}`,
                )}
              >
                {repository.forkedFrom.name}
              </a>
            </p>
          ) : null}
          <CodeEntryList
            ownerLogin={ownerLogin}
            repositoryName={repository.name}
            branch={branch}
            entries={entries}
          />
        </>
      ) : null}
    </main>
  );
}
