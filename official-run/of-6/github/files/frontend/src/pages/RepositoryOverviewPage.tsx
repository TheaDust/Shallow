import { useEffect, useState } from 'react';
import {
  apiRepository,
  apiRepositoryCommits,
  apiRepositoryContents,
} from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import { formatRelativeTime } from '../format';
import CloneMenu from '../components/CloneMenu';
import BranchSelector from '../components/BranchSelector';
import AddFileMenu from '../components/AddFileMenu';
import type {
  RepositoryBranchInfo,
  RepositoryCommit,
  RepositoryFileEntry,
  RepositoryOverview,
  RepositoryTreeEntry,
} from '../types';

interface RepositoryOverviewPageProps {
  owner: string;
  name: string;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }
  return `Updated ${date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

/**
 * Repository overview page titled "owner/repository name" (REQ-2-1-1 / REQ-3).
 * Access is decided on the server: public repositories are open to visitors,
 * private repositories require the organization Owner, a direct role grant,
 * or membership in a team with a role grant. Unauthorized visitors see
 * "Access denied" with a sign-in entry when unauthenticated.
 *
 * REQ-3-2-1: an initialized repository shows the default branch's file list
 * with the README file link and the commit history (one "Initial commit"
 * after creation); both remain after reload because they are read from the
 * persisted server state.
 */
export default function RepositoryOverviewPage({ owner, name }: RepositoryOverviewPageProps) {
  const { auth } = useSession();
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [files, setFiles] = useState<RepositoryFileEntry[]>([]);
  const [entries, setEntries] = useState<RepositoryTreeEntry[]>([]);
  const [branch, setBranch] = useState<RepositoryBranchInfo | null>(null);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setFiles([]);
    setEntries([]);
    setBranch(null);
    setCommits([]);
    setDenied(false);
    setNotFound(false);
    apiRepository(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRepository(result.repository);
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    apiRepositoryContents(owner, name).then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      setBranch(result.branch);
      setFiles(result.files);
      setEntries(result.entries ?? []);
    });
    apiRepositoryCommits(owner, name).then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      setCommits(result.commits);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to view this repository.
        </p>
        {auth.status === 'ready' && !auth.user ? (
          <a className="primary-link" href="#/signin">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Repository not found</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  if (repository === null) {
    return (
      <div className="repository-page">
        <p className="loading">Loading…</p>
      </div>
    );
  }

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const branchName = branch ? branch.name : repository.defaultBranch;
  // REQ-4-4: only Write, Maintain, Admin, or organization Owner accounts may
  // open the file editor from the Code page (Read/Triage/visitors only view;
  // the server re-checks the role on every submission).
  const canWrite =
    repository.role === 'write' ||
    repository.role === 'maintain' ||
    repository.role === 'admin';
  // REQ-4-1: the Code page lists top-level entries (directories and files)
  // with their exact names; a fallback treats flat files as file entries so
  // responses without the entries payload still render the file list.
  const displayEntries: RepositoryTreeEntry[] =
    entries.length > 0 ? entries : files.map((f) => ({ name: f.path, type: 'file', path: f.path }));

  const entryHref = (entry: RepositoryTreeEntry) => {
    const pathPart = entry.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return entry.type === 'directory'
      ? `${repoBase}/tree/${encodeURIComponent(branchName)}/${pathPart}`
      : `${repoBase}/blob/${encodeURIComponent(branchName)}/${pathPart}`;
  };

  // REQ-4-3-1: switching branches navigates the Code page to the selected
  // branch root; the current branch is the one referenced by the URL/page
  // entry, the selector, and the file list (no separate persisted setting).
  const switchBranch = (nextBranch: string) => {
    if (nextBranch === branchName) {
      return;
    }
    navigate(`${repoBase}/tree/${encodeURIComponent(nextBranch)}`);
  };


  return (
    <div className="repository-page">
      <h1 className="repository-title">
        {repository.owner}/{repository.name}
      </h1>
      <div className="repository-overview">
        {/* REQ-3-2-2: a fork shows its source repository with a working link;
            the relationship survives reload because it is read from the
            persisted fork record. */}
        {repository.forkedFrom ? (
          <p className="forked-from">
            Forked from{' '}
            <a
              href={`#/repositories/${encodeURIComponent(
                repository.forkedFrom.owner
              )}/${encodeURIComponent(repository.forkedFrom.name)}`}
            >
              {repository.forkedFrom.owner}/{repository.forkedFrom.name}
            </a>
          </p>
        ) : null}
        <span className="repository-visibility-badge">
          {repository.visibility === 'public' ? 'Public' : 'Private'}
        </span>
        {repository.description ? (
          <p className="repository-description">{repository.description}</p>
        ) : null}
        <dl className="repository-details">
          <div>
            <dt>Owner</dt>
            <dd>{repository.owner}</dd>
          </div>
          <div>
            <dt>Default branch</dt>
            <dd>{repository.defaultBranch}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatUpdatedAt(repository.updatedAt)}</dd>
          </div>
        </dl>
        {/* REQ-3-2-2: the source overview carries the “Fork” button; it opens
            the fork form (protected, so unauthenticated visitors are routed
            to sign-in). */}
        <button
          type="button"
          className="fork-button"
          onClick={() => navigate(`${repoBase}/fork`)}
        >
          Fork
        </button>
      </div>

      {/* REQ-3-3: primary entries for browsing files, viewing repository
          context, and beginning collaboration. "Code" is the navigation link
          to the file browser (the overview itself) and is distinct from the
          clone-menu Code button; Issues and Pull requests lead to their
          repository routes. */}
      <nav className="repository-tabs" aria-label="Repository">
        <a className="repository-tab" href={repoBase}>
          Code
        </a>
        <a className="repository-tab" href={`${repoBase}/issues`}>
          Issues
        </a>
        <a className="repository-tab" href={`${repoBase}/pulls`}>
          Pull requests
        </a>
        {repository.role === 'admin' ? (
          <a className="repository-tab" href={`${repoBase}/settings`}>
            Settings
          </a>
        ) : null}
      </nav>

      <div className="repository-code-section">
        <div className="repository-code-header">
          {/* REQ-4-3-1: the branch selector is the unique button at the top
              of the Code page named "Branch <current branch name>". */}
          <BranchSelector
            owner={owner}
            name={name}
            currentBranch={branchName}
            onSelect={switchBranch}
          />
          <span className="repository-code-header-actions">
            <span className="repository-file-count">
              {displayEntries.length} {displayEntries.length === 1 ? 'file' : 'files'}
            </span>
            {/* REQ-4-4: the unique "Add file" button on the writable Code
                page opens the "Create new file" menuitem; visitors and
                Read/Triage accounts never see it. */}
            {canWrite ? (
              <AddFileMenu owner={owner} name={name} branch={branchName} />
            ) : null}
            {/* REQ-3-2-3: the clone popover Code button is separate from the
                repository navigation link of the same name. */}
            <CloneMenu owner={owner} name={name} />
          </span>
        </div>
        {/* REQ-4-2-1: the commit-count link is the repository page's single
            history link and sits above the file list; clicking it opens the
            branch history directly. The latest commit is shown beside it. */}
        <div className="repository-commit-bar">
          <a className="repository-commits-link" href={`${repoBase}/commits`}>
            {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
          </a>
          {commits.length > 0 ? (
            <span className="repository-latest-commit">
              <strong className="repository-commit-message">{commits[0].message}</strong>
              <span className="repository-commit-meta">
                {commits[0].author ?? 'Unknown'}
                {formatRelativeTime(commits[0].createdAt)
                  ? ` · ${formatRelativeTime(commits[0].createdAt)}`
                  : ''}
              </span>
            </span>
          ) : (
            <span className="muted-text">No commits yet.</span>
          )}
        </div>
        {displayEntries.length === 0 ? (
          <p className="muted-text">This repository is empty.</p>
        ) : (
          <ul className="repository-file-list">
            {displayEntries.map((entry) => (
              <li key={entry.path} className="repository-file-list-item">
                <a className="repository-file-link" href={entryHref(entry)}>
                  {entry.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
