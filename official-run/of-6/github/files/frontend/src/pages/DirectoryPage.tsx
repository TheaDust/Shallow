import { useEffect, useState } from 'react';
import { apiRepositoryTree } from '../api';
import BranchSelector from '../components/BranchSelector';
import AddFileMenu from '../components/AddFileMenu';
import { navigate } from '../router';
import type { RepositoryBranchInfo, RepositoryTreeEntry } from '../types';

interface DirectoryPageProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
}

/**
 * REQ-4-1: directory page of a branch path. Displays the current branch, path
 * breadcrumbs, and the file/directory list of that directory. Entries are
 * links whose exact accessible names are the entry names: directories lead to
 * the tree page at that path, files to the file-content page.
 */
export default function DirectoryPage({ owner, name, branch, path }: DirectoryPageProps) {
  const [branchInfo, setBranchInfo] = useState<RepositoryBranchInfo | null>(null);
  const [entries, setEntries] = useState<RepositoryTreeEntry[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBranchInfo(null);
    setEntries([]);
    setRole(null);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryTree(owner, name, branch, path).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setBranchInfo(result.branch);
        setEntries(result.entries);
        setRole(result.role ?? null);
      } else if (result.status === 403 || result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, branch, path]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const treeBase = `${repoBase}/tree/${encodeURIComponent(branch)}`;
  const pathSegments = path === '' ? [] : path.split('/');

  if (notFound) {
    return (
      <div className="repository-page directory-page">
        <h1 className="repository-title">
          {owner}/{name}
        </h1>
        <p className="muted-text">
          The directory “{path}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  // REQ-4-4: only Write, Maintain, Admin, or organization Owner accounts may
  // open the file editor from the Code page (the server re-checks the role).
  const canWrite = role === 'write' || role === 'maintain' || role === 'admin';

  const entryHref = (entry: RepositoryTreeEntry) => {
    const pathPart = entry.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return entry.type === 'directory'
      ? `${treeBase}/${pathPart}`
      : `${repoBase}/blob/${encodeURIComponent(branch)}/${pathPart}`;
  };

  // REQ-4-3-1: switching branches keeps the current path and only changes the
  // branch read by the page (the URL becomes the new branch's tree page).
  const switchBranch = (nextBranch: string) => {
    if (nextBranch === branch) {
      return;
    }
    const pathPart =
      path === ''
        ? ''
        : `/${path
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/')}`;
    navigate(`${repoBase}/tree/${encodeURIComponent(nextBranch)}${pathPart}`);
  };

  return (
    <div className="repository-page directory-page">
      <h1 className="repository-title">
        {owner}/{name}
      </h1>
      <nav className="file-path-line" aria-label="Path breadcrumbs">
        <a className="repository-back-link" href={treeBase}>
          {owner}/{name}
        </a>
        <span className="path-separator" aria-hidden="true">
          /
        </span>
        <span className="path-branch">{branch}</span>
        {pathSegments.map((segment, index) => {
          const isLast = index === pathSegments.length - 1;
          const prefix = pathSegments
            .slice(0, index + 1)
            .map((s) => encodeURIComponent(s))
            .join('/');
          return (
            <span key={`${segment}-${index}`} className="path-part">
              <span className="path-separator" aria-hidden="true">
                /
              </span>
              {isLast ? (
                <span className="path-current">{segment}</span>
              ) : (
                <a className="path-link" href={`${treeBase}/${prefix}`}>
                  {segment}
                </a>
              )}
            </span>
          );
        })}
      </nav>
      {loadError ? (
        <p role="alert" className="form-error">
          The directory could not be loaded.
        </p>
      ) : branchInfo === null ? (
        <p className="loading">Loading…</p>
      ) : (
        <div className="repository-code-section">
          <div className="repository-code-header">
            {/* REQ-4-3-1: the branch selector is the unique button at the top
                of the Code page named "Branch <current branch name>". */}
            <BranchSelector
              owner={owner}
              name={name}
              currentBranch={branchInfo.name}
              onSelect={switchBranch}
            />
            <span className="repository-code-header-actions">
              <span className="repository-file-count">
                {entries.length} {entries.length === 1 ? 'item' : 'items'}
              </span>
              {/* REQ-4-4: the unique "Add file" button on the writable Code
                  page opens the "Create new file" menuitem. */}
              {canWrite ? (
                <AddFileMenu owner={owner} name={name} branch={branchInfo.name} />
              ) : null}
            </span>
          </div>
          {entries.length === 0 ? (
            <p className="muted-text">This directory is empty.</p>
          ) : (
            <ul className="repository-file-list">
              {entries.map((entry) => (
                <li key={entry.path} className="repository-file-list-item">
                  <a className="repository-file-link" href={entryHref(entry)}>
                    {entry.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
