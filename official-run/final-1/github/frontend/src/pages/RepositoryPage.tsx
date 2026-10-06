import { AddFileMenu } from "../components/AddFileMenu";
import { AppHeader } from "../components/AppHeader";
import { BranchSelector } from "../components/BranchSelector";
import { CloneMenu } from "../components/CloneMenu";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { useBranchAddress } from "../lib/branch-address";
import { navigate } from "../lib/hash-route";
import { formatTimestamp } from "../lib/format";
import { createRepositoryBranch, fetchRepository, fetchRepositoryBranches } from "../lib/org-api";
import {
  organizationHash,
  repositoryBlobHash,
  repositoryCodeHash,
  repositoryCommitsHash,
  repositoryHash,
  repositoryIssuesHash,
  repositoryPullsHash,
  repositoryReleasesHash,
  repositorySettingsHash,
} from "../lib/routes";
import { useSession } from "../lib/session";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";

/**
 * Repository overview. The heading reads "owner/repository name" and the owner,
 * visibility marker, description, default branch, README and commit count come
 * from the same stored record the lists and the code views use. Private
 * repositories are only rendered when the server allowed the read; otherwise the
 * page shows the denial message instead of any content.
 */
export function RepositoryPage({ owner, name }: { owner: string; name: string }) {
  const { user } = useSession();
  const { status, data, error } = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  // The overview reads the default branch; keeping it in the address means a
  // reload restores the same entry and the address identifies the branch.
  useBranchAddress(data?.defaultBranch);

  /** The branch selector of the repository entry opens the Code page. */
  const openBranch = (next: string, defaultBranch: string) => {
    const search = new URLSearchParams();
    if (next && next !== defaultBranch) search.set("branch", next);
    navigate(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/code`, search);
  };

  const createBranch = async (next: string): Promise<string | null> => {
    const result = await createRepositoryBranch(owner, name, {
      name: next,
      base: data?.defaultBranch ?? "main",
    });
    if (!result.ok) return result.fieldErrors.name ?? result.message;
    openBranch(result.value.name, data?.defaultBranch ?? "main");
    return null;
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository">
        {status === "loading" ? <LoadingNote label="Loading repository…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {status === "ready" && data ? (
          <>
            <nav className="repository__breadcrumb" aria-label="Breadcrumb">
              <a href={organizationHash(data.owner.id)}>{data.owner.displayName}</a>
            </nav>
            <h1 className="repository__title">
              {data.owner.displayName}/{data.name}
            </h1>
            <p className="repository__badges">
              <span className="repository__visibility" data-visibility={data.visibility}>
                {data.visibility === "public" ? "Public" : "Private"}
              </span>
              {data.archived ? (
                <span className="repository__archived">Archived</span>
              ) : null}
            </p>
            {data.description ? <p className="repository__description">{data.description}</p> : null}
            {data.fork ? (
              <p className="repository__fork">
                Forked from{" "}
                <a href={repositoryHash(data.fork.owner.id, data.fork.name)}>{data.fork.name}</a>
              </p>
            ) : null}
            <div className="repository__branch-row">
              <BranchSelector
                currentBranch={data.defaultBranch}
                branches={branches.data?.branches ?? [{ name: data.defaultBranch }]}
                canCreateBranch={branches.data?.canWrite ?? false}
                onSelectBranch={(next) => openBranch(next, data.defaultBranch)}
                onCreateBranch={createBranch}
              />
            </div>
            <nav className="repository__tabs" aria-label="Repository">
              <a className="repository__tab" href={repositoryCodeHash(data.owner.id, data.name)}>
                Code
              </a>
              <a className="repository__tab" href={repositoryIssuesHash(data.owner.id, data.name)}>
                Issues
              </a>
              <a className="repository__tab" href={repositoryPullsHash(data.owner.id, data.name)}>
                Pull requests
              </a>
              <a className="repository__tab" href={repositoryReleasesHash(data.owner.id, data.name)}>
                Releases
              </a>
              <span className="repository__tab-group">
                <a
                  className="repository__tab"
                  href={repositoryCommitsHash(data.owner.id, data.name)}
                >
                  Commits
                </a>
                <span className="repository__commit-count">{data.commitCount}</span>
              </span>
              {data.canManage ? (
                <a
                  className="repository__tab"
                  href={repositorySettingsHash(data.owner.id, data.name)}
                >
                  Settings
                </a>
              ) : null}
            </nav>
            <div className="repository__actions">
              <CloneMenu repository={data} />
              {data.canWrite ? (
                <AddFileMenu owner={data.owner.id} name={data.name} branch={data.defaultBranch} />
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  if (!user) {
                    navigate("/sign-in");
                    return;
                  }
                  navigate(
                    `/repositories/${encodeURIComponent(data.owner.id)}/${encodeURIComponent(data.name)}/fork`,
                  );
                }}
              >
                Fork
              </Button>
            </div>
            <dl className="repository__facts">
              <dt>Default branch</dt>
              <dd>{data.defaultBranch}</dd>
              <dt>Updated</dt>
              <dd>{formatTimestamp(data.updatedAt)}</dd>
            </dl>
            {data.readmePath ? (
              <section className="repository__readme" aria-label="README file">
                <a
                  className="repository__readme-link"
                  href={repositoryBlobHash(data.owner.id, data.name, data.readmePath)}
                >
                  {data.readmePath}
                </a>
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
