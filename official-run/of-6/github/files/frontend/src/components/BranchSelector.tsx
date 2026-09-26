import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { apiCreateBranch, apiRepositoryBranches } from '../api';
import type { RepositoryBranchInfo } from '../types';

interface BranchSelectorProps {
  owner: string;
  name: string;
  currentBranch: string;
  onSelect: (branch: string) => void;
}

/**
 * REQ-4-3-1: the branch selector at the top of the Code page. It is a unique
 * button named "Branch <current branch name>"; opening it shows a textbox
 * named "Find branch" and one option per branch whose exact accessible name
 * is the branch name, with the current branch marked. The options filter live
 * as the user types (no Enter or search button is required); an unmatched
 * query shows the "No matching branch" state. Escape closes the selector and
 * the active branch only changes when the user selects a branch (the branch
 * is the one in the page entry/file list, not a separate user setting).
 *
 * REQ-4-3-2: when the signed-in account may create branches (Write, Maintain,
 * Admin, or organization Owner status, reported by the server as canCreate),
 * typing a valid unused name immediately shows the create entry (role option,
 * accessible name "Create branch: <name>") whose displayed base is the
 * current branch head; an invalid name immediately shows "Invalid branch".
 * Selecting the create entry posts the new reference and switches the page to
 * it (no second confirmation); a rejected request shows the server error and
 * leaves the current branch and stored branches unchanged. Read/Triage/visitor
 * accounts only browse and keep the REQ-4-3-1 "No matching branch" state.
 */
export default function BranchSelector({
  owner,
  name,
  currentBranch,
  onSelect,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [branches, setBranches] = useState<RepositoryBranchInfo[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const createOptionRef = useRef<HTMLLIElement>(null);

  // REQ-4-3-2: the branch-name rule mirrors the server exactly so the live
  // "Invalid branch" state always agrees with the server-side rejection.
  const isValidBranchName = useCallback((candidate: string) => {
    if (candidate.length < 1 || candidate.length > 255) {
      return false;
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(candidate)) {
      return false;
    }
    if (candidate.endsWith('/') || candidate.endsWith('.')) {
      return false;
    }
    if (candidate.includes('..') || candidate.includes('//')) {
      return false;
    }
    return true;
  }, []);

  // Load the branch list when the page becomes interactive so the popover can
  // show the options as soon as it is opened.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setBranches(null);
      setLoadError(false);
      apiRepositoryBranches(owner, name).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setBranches(result.branches);
          setCanCreate(result.canCreate);
        } else {
          setLoadError(true);
        }
      });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  // Close the popover when the user clicks outside of it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Focus the Find branch textbox as soon as the selector opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setCreateError(null);
    triggerRef.current?.focus();
  };

  const toggle = () => {
    setOpen((v) => !v);
    if (open) {
      setQuery('');
      setCreateError(null);
      triggerRef.current?.focus();
    }
  };

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = (branches ?? []).filter((b) =>
    b.name.toLowerCase().includes(trimmedQuery)
  );
  const nameValid = query !== '' && isValidBranchName(query);
  const nameUnused =
    nameValid && !(branches ?? []).some((b) => b.name === query);
  const showCreate = nameUnused && canCreate;
  const showInvalid = query !== '' && !nameValid;
  const showNoMatch = query !== '' && !showInvalid && !showCreate && filtered.length === 0;

  const selectBranch = (branchName: string) => {
    setOpen(false);
    setQuery('');
    onSelect(branchName);
  };

  // REQ-4-3-2: creates the branch at the current branch head and switches the
  // browsing context to it. A rejected request (duplicate, permission, or
  // name race) shows the server error and leaves the active branch and the
  // stored branches unchanged; the list is refreshed so a concurrent
  // duplicate stops offering the create entry.
  const createBranch = async () => {
    if (creating || !showCreate) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    const result = await apiCreateBranch(owner, name, {
      name: query,
      base: currentBranch,
    });
    if (result.ok) {
      setOpen(false);
      setQuery('');
      setCreating(false);
      onSelect(result.branch.name);
      return;
    }
    setCreating(false);
    setCreateError(
      result.errors?.name ??
        result.errors?.base ??
        result.message ??
        'Branch could not be created'
    );
    // Refresh the branch list so the (possibly stale) state matches the
    // server, e.g. a concurrent duplicate now appears as a matching option.
    apiRepositoryBranches(owner, name).then((listResult) => {
      if (listResult.ok) {
        setBranches(listResult.branches);
        setCanCreate(listResult.canCreate);
      }
    });
  };

  const focusOption = (index: number) => {
    if (filtered.length === 0) {
      if (showCreate) {
        createOptionRef.current?.focus();
      }
      return;
    }
    const target = filtered[Math.max(0, Math.min(index, filtered.length - 1))];
    optionRefs.current.get(target.name)?.focus();
  };

  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLLIElement>,
    branchName: string
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectBranch(branchName);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const index = filtered.findIndex((b) => b.name === branchName);
      if (index + 1 < filtered.length) {
        focusOption(index + 1);
      } else if (showCreate) {
        createOptionRef.current?.focus();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const index = filtered.findIndex((b) => b.name === branchName);
      focusOption(index - 1);
    }
  };

  const handleCreateOptionKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      createBranch();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(filtered.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={containerRef} className="branch-selector">
      <button
        ref={triggerRef}
        type="button"
        className="branch-selector-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={toggle}
      >
        <span aria-hidden="true" className="branch-selector-icon">
          ⑂
        </span>
        Branch {currentBranch}
        <span aria-hidden="true" className="branch-selector-caret">
          ▾
        </span>
      </button>
      {open ? (
        <div className="branch-selector-popover" onKeyDown={handlePopoverKeyDown}>
          <input
            ref={inputRef}
            type="text"
            className="branch-find-input"
            aria-label="Find branch"
            placeholder="Find branch"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCreateError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusOption(0);
              }
            }}
          />
          {loadError ? (
            <p role="alert" className="branch-selector-error">
              Branches could not be loaded.
            </p>
          ) : branches === null ? (
            <p className="branch-selector-loading">Loading…</p>
          ) : (
            <>
              {filtered.length > 0 || showCreate ? (
                <ul role="listbox" aria-label="Branches" className="branch-list">
                  {filtered.map((branch) => (
                    <li
                      key={branch.name}
                      ref={(node) => {
                        if (node) {
                          optionRefs.current.set(branch.name, node);
                        } else {
                          optionRefs.current.delete(branch.name);
                        }
                      }}
                      role="option"
                      aria-selected={branch.name === currentBranch}
                      tabIndex={-1}
                      className={`branch-option${
                        branch.name === currentBranch ? ' current' : ''
                      }`}
                      onClick={() => selectBranch(branch.name)}
                      onKeyDown={(event) => handleOptionKeyDown(event, branch.name)}
                    >
                      <span aria-hidden="true" className="branch-option-check">
                        {branch.name === currentBranch ? '✓' : ''}
                      </span>
                      <span className="branch-option-name">{branch.name}</span>
                    </li>
                  ))}
                  {showCreate ? (
                    <li
                      ref={createOptionRef}
                      role="option"
                      aria-label={`Create branch: ${query}`}
                      aria-disabled={creating}
                      tabIndex={-1}
                      className={`branch-option create-branch-option${
                        creating ? ' creating' : ''
                      }`}
                      onClick={() => createBranch()}
                      onKeyDown={(event) => handleCreateOptionKeyDown(event)}
                    >
                      <span aria-hidden="true" className="branch-option-check" />
                      <span className="branch-option-name">
                        Create branch: {query}
                      </span>
                      <span
                        aria-hidden="true"
                        className="create-branch-base"
                      >
                        {' '}
                        from '{currentBranch}'
                      </span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {createError ? (
                <p role="alert" className="branch-selector-error">
                  {createError}
                </p>
              ) : null}
              {showInvalid ? (
                <p className="branch-invalid">Invalid branch</p>
              ) : null}
              {showNoMatch ? (
                <p className="branch-no-matching">No matching branch</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
