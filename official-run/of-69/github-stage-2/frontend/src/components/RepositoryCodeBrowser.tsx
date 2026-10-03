import { useId, useState } from "react";

import { navigate } from "../lib/hash-route";
import { createBranch } from "../lib/organization-api";
import type { RepositoryCodeModel } from "../lib/repository-code";
import { repositoryCodePath, type RepositoryOwnerRef } from "../lib/routes";
import { apiErrorMessage } from "../lib/use-async-data";
import { BRANCH_INVALID_MESSAGE, isValidBranchName } from "../lib/write-rules";
import { Button } from "../ui";

export interface RepositoryCodeBrowserProps {
  owner: RepositoryOwnerRef;
  repository: string;
  code: RepositoryCodeModel;
  defaultBranch: string;
  /** Write, Maintain, Admin or organization Owner may create branches. */
  canWrite: boolean;
}

/**
 * The branch selector at the top of the Code page. Its accessible name is
 * “Branch <current branch>”; the popover filters the branch names as the user
 * types — without Enter or a separate search action — and reports “No matching
 * branch” or, for a name the branch rules refuse, “Invalid branch”. A writer
 * also gets a “Create branch: <name>” option for a valid unused name, which
 * creates the reference and switches the browsing context to it. Escape closes
 * the selector without changing the branch.
 */
function BranchSelector({ owner, repository, code, defaultBranch, canWrite }: RepositoryCodeBrowserProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const query = filter.trim();
  const queryKey = query.toLowerCase();
  const matches = code.branches.filter((branch) => branch.name.toLowerCase().includes(queryKey));
  const invalid = query.length > 0 && !isValidBranchName(query);
  const canCreate =
    query.length > 0 &&
    !invalid &&
    canWrite &&
    !code.branches.some((branch) => branch.name === query);

  function close() {
    setOpen(false);
    setFilter("");
    setError(null);
  }

  function selectBranch(name: string) {
    // Navigate through the router first: the popover unmounts on close, so a
    // default hash navigation could not be relied on afterwards.
    navigate(
      repositoryCodePath(owner, repository, {
        branch: name === defaultBranch ? undefined : name,
        path: code.path || undefined,
      }),
    );
    close();
  }

  async function createAndSwitch(name: string) {
    setBusy(true);
    setError(null);
    try {
      await createBranch(owner.name, repository, { name, base: code.branch });
      navigate(repositoryCodePath(owner, repository, { branch: name === defaultBranch ? undefined : name }));
      close();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to create the branch."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="branch-selector">
      <Button
        aria-label={`Branch ${code.branch}`}
        aria-expanded={open}
        onClick={() => {
          setFilter("");
          setError(null);
          setOpen((value) => !value);
        }}
      >
        {code.branch}
      </Button>
      {open ? (
        <div
          className="branch-selector__popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <input
            className="branch-selector__find"
            type="text"
            aria-label="Find branch"
            placeholder="Find branch"
            autoComplete="off"
            aria-controls={listId}
            aria-autocomplete="list"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <ul id={listId} className="branch-selector__list" role="listbox" aria-label="Branches">
            {matches.map((branch) => (
              <li key={branch.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={branch.name === code.branch}
                  className="branch-selector__option"
                  onClick={() => selectBranch(branch.name)}
                >
                  {branch.name}
                </button>
              </li>
            ))}
            {canCreate ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="branch-selector__option"
                  disabled={busy}
                  onClick={() => void createAndSwitch(query)}
                >
                  {`Create branch: ${query}`}
                </button>
              </li>
            ) : null}
          </ul>
          {matches.length === 0 && !canCreate ? (
            <p className="branch-selector__empty">{invalid ? BRANCH_INVALID_MESSAGE : "No matching branch"}</p>
          ) : null}
          {error ? (
            <p className="branch-selector__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Code page main area: the branch selector, the entries of the current
 * path — directories and files are links named exactly after the entry — and
 * the read-only view of the opened file with its name, path and branch.
 */
export function RepositoryCodeBrowser({
  owner,
  repository,
  code,
  defaultBranch,
  canWrite,
}: RepositoryCodeBrowserProps) {
  return (
    <section className="repository-code" aria-label="Repository code">
      <div className="repository-code__toolbar">
        <BranchSelector
          owner={owner}
          repository={repository}
          code={code}
          defaultBranch={defaultBranch}
          canWrite={canWrite}
        />
      </div>
      {code.path ? (
        <p className="repository-path">
          Path: <span className="repository-path__value">{code.path}</span>
        </p>
      ) : null}
      {code.entries.length > 0 ? (
        <ul className="file-list">
          {code.entries.map((entry) => (
            <li key={`${entry.type}:${entry.path}`} className="file-list__item">
              <a className="file-list__link" data-kind={entry.type} href={entry.href}>
                {entry.name}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="repository-code__empty">This repository has no files on this branch.</p>
      )}
      {code.file ? (
        <section className="repository-file" aria-labelledby="repository-file-heading">
          <h2 id="repository-file-heading" className="repository-file__name">
            {code.file.name}
          </h2>
          <p className="repository-file__path">
            Path: <span className="repository-file__path-value">{code.file.path}</span>
          </p>
          <p className="repository-file__branch">
            Branch: <span className="repository-file__branch-value">{code.branch}</span>
          </p>
          <pre className="repository-file__content">{code.file.content}</pre>
        </section>
      ) : null}
    </section>
  );
}
