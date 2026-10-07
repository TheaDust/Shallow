import { useEffect, useState } from "react";

import { AddFileMenu } from "../components/AddFileMenu";
import { AppHeader } from "../components/AppHeader";
import { BranchSelector } from "../components/BranchSelector";
import { CloneMenu } from "../components/CloneMenu";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import { formatTimestamp } from "../lib/format";
import {
  createRepositoryBranch,
  fetchRepository,
  fetchRepositoryBranches,
  type RepositoryDetail,
} from "../lib/org-api";
import { subscribeRepositoryStatus } from "../lib/repository-status";
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
 *
 * An archive or restore the settings panel confirmed arrives through
 * `repository-status` (REQ-3-5), so the marker shown here is the stored status
 * even though the request settled after this view opened.
 */
interface LiveStatus {
  key: string;
  repository: RepositoryDetail | null;
  message: string | null;
}

export function RepositoryPage({ owner, name }: { owner: string; name: string }) {
  const { user } = useSession();
  const { status, data, error } = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const reloadBranches = branches.reload;
  const [live, setLive] = useState<LiveStatus | null>(null);
  const key = `${owner}\u0000${name}`;

  useEffect(
    () =>
      subscribeRepositoryStatus((event) => {
        if (event.owner !== owner || event.name !== name) return;
        // Archiving also closes the branch-writing controls of this view.
        if (event.kind === "settled") reloadBranches();
        setLive(
          event.kind === "settled"
            ? { key, repository: event.repository, message: null }
            : { key, repository: null, message: event.message },
        );
      }),
    [key, owner, name, reloadBranches],
  );

  const liveStatus = live?.key === key ? live : null;
  const repository = liveStatus?.repository ?? data;

  /** The branch selector of the repository entry opens the Code page of that
   * branch; the selected branch travels in the address of the Code page. */
  const openBranch = (next: string, defaultBranch: string) => {
    const search = new URLSearchParams();
    search.set("branch", next || defaultBranch);
    navigate(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/code`, search);
  };

  const createBranch = async (next: string): Promise<string | null> => {
    const result = await createRepositoryBranch(owner, name, {
      name: next,
      base: repository?.defaultBranch ?? "main",
    });
    if (!result.ok) return result.fieldErrors.name ?? result.message;
    openBranch(result.value.name, repository?.defaultBranch ?? "main");
    return null;
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository">
        {status === "loading" ? <LoadingNote label="Loading repository…" /> : null}
        {status === "error" && error ? <ErrorHeading error={error} /> : null}
        {liveStatus?.message ? (
          <p className="repository__status-error" role="alert">
            {liveStatus.message}
          </p>
        ) : null}
        {repository ? (
          <>
            <nav className="repository__breadcrumb" aria-label="Breadcrumb">
              <a href={organizationHash(repository.owner.id)}>{repository.owner.displayName}</a>
            </nav>
            <h1 className="repository__title">
              {repository.owner.displayName}/{repository.name}
            </h1>
            <p className="repository__badges">
              <span className="repository__visibility" data-visibility={repository.visibility}>
                {repository.visibility === "public" ? "Public" : "Private"}
              </span>
              {repository.archived ? (
                <span className="repository__archived" data-archived="true">
                  Archived
                </span>
              ) : null}
            </p>
            {repository.description ? (
              <p className="repository__description">{repository.description}</p>
            ) : null}
            {repository.fork ? (
              <p className="repository__fork">
                Forked from{" "}
                <a href={repositoryHash(repository.fork.owner.id, repository.fork.name)}>
                  {repository.fork.name}
                </a>
              </p>
            ) : null}
            <div className="repository__branch-row">
              <BranchSelector
                currentBranch={repository.defaultBranch}
                branches={branches.data?.branches ?? [{ name: repository.defaultBranch }]}
                canCreateBranch={branches.data?.canWrite ?? false}
                onSelectBranch={(next) => openBranch(next, repository.defaultBranch)}
                onCreateBranch={createBranch}
              />
            </div>
            <nav className="repository__tabs" aria-label="Repository">
              <a className="repository__tab" href={repositoryCodeHash(repository.owner.id, repository.name)}>
                Code
              </a>
              <a className="repository__tab" href={repositoryIssuesHash(repository.owner.id, repository.name)}>
                Issues
              </a>
              <a className="repository__tab" href={repositoryPullsHash(repository.owner.id, repository.name)}>
                Pull requests
              </a>
              <a className="repository__tab" href={repositoryReleasesHash(repository.owner.id, repository.name)}>
                Releases
              </a>
              <span className="repository__tab-group">
                <a
                  className="repository__tab"
                  href={repositoryCommitsHash(repository.owner.id, repository.name)}
                >
                  Commits
                </a>
                <span className="repository__commit-count">{repository.commitCount}</span>
              </span>
              {repository.canManage ? (
                <a
                  className="repository__tab"
                  href={repositorySettingsHash(repository.owner.id, repository.name)}
                >
                  Settings
                </a>
              ) : null}
            </nav>
            <div className="repository__actions">
              <CloneMenu repository={repository} />
              {repository.canWrite ? (
                <AddFileMenu
                  owner={repository.owner.id}
                  name={repository.name}
                  branch={repository.defaultBranch}
                />
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  if (!user) {
                    navigate("/sign-in");
                    return;
                  }
                  navigate(
                    `/repositories/${encodeURIComponent(repository.owner.id)}/${encodeURIComponent(repository.name)}/fork`,
                  );
                }}
              >
                Fork
              </Button>
            </div>
            <dl className="repository__facts">
              <dt>Default branch</dt>
              <dd>{repository.defaultBranch}</dd>
              <dt>Updated</dt>
              <dd>{formatTimestamp(repository.updatedAt)}</dd>
            </dl>
            {repository.readmePath ? (
              <section className="repository__readme" aria-label="README file">
                <a
                  className="repository__readme-link"
                  href={repositoryBlobHash(repository.owner.id, repository.name, repository.readmePath)}
                >
                  {repository.readmePath}
                </a>
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
