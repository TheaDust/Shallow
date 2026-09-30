import { Fragment, useState, type FormEvent } from "react";

import { AccessDeniedPage } from "./AccessDeniedPage";
import { NotFoundPage, repositoryAccessHint } from "./NotFoundPage";
import { navigate } from "../lib/hash-route";
import {
  repositoryCommitsHref,
  repositoryCommitsPath,
  repositoryCompareHref,
} from "../lib/repository-routes";
import {
  fetchRepositoryCommits,
  repositoryTitle,
  type RepositoryBranch,
  type RepositoryCommitsPayload,
} from "../lib/repositories-api";
import { BranchSelector } from "../repository/BranchSelector";
import { CommitList } from "../repository/CommitList";
import { RepositoryBreadcrumbs } from "../repository/RepositoryBreadcrumbs";
import { RepositoryChrome } from "../repository/RepositoryChrome";
import { useRepositoryResource } from "../repository/useRepositoryResource";
import { Button } from "../ui";

export interface RepositoryCommitsPageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
}

/**
 * Commit history page (REQ-4-2-1). Without a path it reads the whole branch in
 * reverse chronological order; with a path it keeps only the commits that
 * changed that file. Both scopes are read-only.
 */
export function RepositoryCommitsPage({ owner, name, branch, path }: RepositoryCommitsPageProps) {
  const state = useRepositoryResource<RepositoryCommitsPayload>(
    () => fetchRepositoryCommits(owner, name, branch, path),
    [owner, name, branch, path],
  );

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <p role="status">Loading commit history…</p>
      </main>
    );
  }

  if (state.status === "denied") return <AccessDeniedPage owner={owner} name={name} />;
  if (state.status === "missing") return <NotFoundPage hint={repositoryAccessHint()} />;
  if (state.status === "error") {
    return (
      <main>
        <h1>Commit history unavailable</h1>
        <p role="alert">The commit history could not be loaded. Reload the page to try again.</p>
      </main>
    );
  }

  const { repository, commits, files } = state.value;
  const currentBranch = state.value.branch;
  const currentPath = state.value.path;
  const branches: RepositoryBranch[] =
    repository.branches ?? [{ name: currentBranch, headCommitId: null }];

  return (
    <main>
      <RepositoryChrome
        owner={owner}
        name={name}
        title={repositoryTitle(repository)}
        visibility={repository.visibility}
        description={repository.description}
        activeEntry="Code"
      />
      <div className="repository-code__toolbar">
        <BranchSelector
          owner={owner}
          name={name}
          branch={currentBranch}
          branches={branches}
          branchHref={(next) => repositoryCommitsHref(owner, name, next, currentPath)}
        />
      </div>
      <p className="repository-branch">
        Branch: <span className="repository-branch__name">{currentBranch}</span>
      </p>
      {currentPath ? (
        <RepositoryBreadcrumbs
          owner={owner}
          name={name}
          branch={currentBranch}
          path={currentPath}
          leaf="file"
        />
      ) : null}
      <h2 className="commits-heading">Commit history</h2>
      <p className="commits-scope">
        {currentPath ? (
          <>
            Commits that changed <span className="commits-scope__path">{currentPath}</span>
          </>
        ) : (
          <>All commits on this branch, newest first.</>
        )}
      </p>
      <p className="commits-compare">
        <a href={repositoryCompareHref(owner, name)}>Compare</a>
      </p>
      <CommitsPathFilter
        owner={owner}
        name={name}
        branch={currentBranch}
        path={currentPath}
        files={files}
        key={`${currentBranch}:${currentPath}`}
      />
      <CommitList
        owner={owner}
        name={name}
        commits={commits}
        emptyMessage={currentPath ? "No commits changed this path." : undefined}
      />
      {currentPath ? (
        <p className="commits-back">
          <a href={repositoryCommitsHref(owner, name, currentBranch)}>All commits</a>
        </p>
      ) : null}
    </main>
  );
}

interface CommitsPathFilterProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
  files: string[];
}

/**
 * Chooses the history scope: the file paths of the branch are offered as links
 * named after the file, and a path field limits the same history to a typed
 * path. Both scopes read the same stored commits.
 */
function CommitsPathFilter({ owner, name, branch, path, files }: CommitsPathFilterProps) {
  const [value, setValue] = useState(path);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(repositoryCommitsPath(owner, name, branch, value.trim()));
  };

  const optionsId = "commits-path-options";

  return (
    <div className="commits-filter">
      <form className="commits-filter__form" onSubmit={submit}>
        <label className="commits-filter__label" htmlFor="commits-path">
          Path
        </label>
        <input
          id="commits-path"
          className="commits-filter__input"
          type="text"
          name="path"
          autoComplete="off"
          placeholder="Filter commits by file path"
          list={optionsId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <datalist id={optionsId}>
          {files.map((file) => (
            <option key={file} value={file} />
          ))}
        </datalist>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {files.length > 0 ? (
        <p className="commits-filter__files">
          <span className="commits-filter__files-label">File history:</span>{" "}
          {files.map((file, index) => (
            <Fragment key={file}>
              {index > 0 ? <span aria-hidden="true">, </span> : null}
              {/* The full path keeps every file scope unambiguous when two
                  directories hold a file of the same name. */}
              <a href={repositoryCommitsHref(owner, name, branch, file)}>{file}</a>
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}
