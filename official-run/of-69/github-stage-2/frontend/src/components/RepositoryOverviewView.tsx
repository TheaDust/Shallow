import { useState } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";
import type { RepositoryOwner, RepositorySummary, RepositoryViewer } from "../lib/organization-api";
import { buildOverviewModel } from "../lib/repository-overview";
import { repositoryPath, type RepositoryOwnerRef } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { canWriteRepository } from "../lib/write-rules";
import { useSession } from "../session/session-context";
import { RepositoryForkDialog } from "./RepositoryForkDialog";
import { RepositoryLayout } from "./RepositoryLayout";
import { RepositoryOverviewBody } from "./RepositoryOverviewBody";

/** The detail payload of an organization or personal repository, normalized. */
export interface RepositoryOverviewData {
  owner: RepositoryOwner;
  viewer: RepositoryViewer;
  repository: RepositorySummary;
  readme?: { path: string; content: string } | null;
  commits?: { id: string; message: string; author: string; createdAt: string }[] | null;
  branch?: string | null;
  branches?: { name: string }[] | null;
  files?: { path: string; content: string }[] | null;
}

export interface RepositoryOverviewViewProps {
  owner: RepositoryOwnerRef;
  repository: string;
  /** Loads the detail of one branch (the default branch when none is given). */
  load(branch?: string): Promise<RepositoryOverviewData>;
}

/**
 * The repository page shared by organization and personal repositories: it
 * names the repository as “owner/repository name”, shows the Public/Private
 * marker, and carries the Code page — the branch selector, the directory
 * entries of the current path, the read-only file view, the clone popover, the
 * Fork entry for a signed-in reader and the commit history.
 */
export function RepositoryOverviewView({ owner, repository, load }: RepositoryOverviewViewProps) {
  const { account } = useSession();
  const location = useHashLocation();
  const branchParam = location.search.get("branch") ?? undefined;
  const detail = useAsyncData(() => load(branchParam), [owner.type, owner.name, repository, branchParam]);
  const [forkOpen, setForkOpen] = useState(false);
  const loaded = detail.data;

  const ownerDisplayName = loaded?.owner.displayName ?? owner.name;
  const model = loaded ? buildOverviewModel(owner, repository, loaded, location.search) : null;
  const sourceOwner = loaded?.owner ?? { type: owner.type, name: owner.name, displayName: owner.name };
  const canWrite = canWriteRepository(loaded?.viewer);
  const defaultBranch = loaded?.repository.defaultBranch ?? "main";
  const code = model?.code ?? null;

  return (
    <RepositoryLayout
      owner={{ ...owner, displayName: ownerDisplayName }}
      repositoryName={repository}
      activeSection="overview"
      canManage={loaded?.viewer.canManage ?? false}
      commitsParams={code && code.branch !== defaultBranch ? { branch: code.branch } : undefined}
      visibility={loaded?.repository.visibility ?? null}
      account={account}
      heading={
        <>
          <span className="repository-heading__path">
            {loaded ? `${ownerDisplayName}/${loaded.repository.name}` : repository}{" "}
          </span>
          {loaded && loaded.owner.type === "organization" ? (
            <span className="page-heading__identifier">{`${loaded.owner.name}/${loaded.repository.name}`}</span>
          ) : null}
        </>
      }
    >
      {detail.loading ? <p role="status">Loading repository…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {model ? (
        <RepositoryOverviewBody
          description={model.description}
          defaultBranch={model.defaultBranch}
          updatedAt={model.updatedAt}
          owner={owner}
          repositoryName={repository}
          code={model.code}
          forkedFrom={model.forkedFrom}
          cloneUrls={model.cloneUrls}
          canFork={true}
          canWrite={canWrite}
          onFork={() => {
            if (account) setForkOpen(true);
            else navigate("/signin");
          }}
        />
      ) : null}
      {forkOpen && account && loaded ? (
        <RepositoryForkDialog
          source={{
            ownerName: sourceOwner.name,
            repositoryName: loaded.repository.name,
            name: loaded.repository.name,
            visibility: loaded.repository.visibility,
          }}
          username={account.username}
          onOpenChange={setForkOpen}
          onForked={(result) => {
            setForkOpen(false);
            navigate(repositoryPath(result.owner, result.repository.name));
          }}
        />
      ) : null}
    </RepositoryLayout>
  );
}
