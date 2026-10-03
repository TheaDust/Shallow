import { useEffect, useId, useRef, useState } from "react";

import { fieldErrorsOf, messageOf } from "../api/auth";
import { createRepositoryBranch, fetchRepositoryBranches } from "../api/organizations";
import { INVALID_BRANCH_MESSAGE, isValidBranchName } from "../lib/branch-names";
import { Button } from "../ui";

export interface BranchSelectorProps {
  ownerLogin: string;
  repositoryName: string;
  /** The branch the current page reads; the selector button shows it. */
  currentBranch: string;
  /** Whether the viewer may create a branch (Write, Maintain, Admin, Owner). */
  canCreate: boolean;
  /** Switches the page to the chosen branch’s snapshot. */
  onSelect(branch: string): void;
}

/**
 * The branch selector at the top of a code page (REQ-4-3-1).
 *
 * A unique button named `Branch <current branch name>` opens the panel with the
 * `Find branch` textbox and one `option` per stored branch, filtered as the user
 * types. A viewer with write permission additionally gets the
 * `Create branch: <name>` option for a valid unused name; an invalid name shows
 * the `Invalid branch` message and a query without a match shows the
 * `No matching branch` state. Escape closes the panel and nothing about the
 * active branch changes until an option is selected.
 */
export function BranchSelector({
  ownerLogin,
  repositoryName,
  currentBranch,
  canCreate,
  onSelect,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = `${useId()}-branches`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailure(null);
    fetchRepositoryBranches(ownerLogin, repositoryName)
      .then((result) => {
        if (!cancelled) setBranches(result.branches.map((branch) => branch.name));
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ownerLogin, repositoryName]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // The current branch is always selectable, even for a snapshot whose branch
  // record is missing (a repository whose history was never initialized).
  const names = branches.length > 0 ? branches : [currentBranch];
  const value = query.trim();
  const needle = value.toLowerCase();
  const matching = value ? names.filter((name) => name.toLowerCase().includes(needle)) : names;
  const invalid = value.length > 0 && !isValidBranchName(value);
  const creatable = canCreate && value.length > 0 && !invalid && !names.includes(value);

  const create = async () => {
    setPending(true);
    setFailure(null);
    try {
      await createRepositoryBranch(ownerLogin, repositoryName, { name: value, from: currentBranch });
    } catch (error) {
      setPending(false);
      const fields = fieldErrorsOf(error);
      setFailure(fields.name ?? messageOf(error, "Branch creation failed"));
      return;
    }
    setPending(false);
    setOpen(false);
    setQuery("");
    onSelect(value);
  };

  return (
    <div className="branch-selector" ref={rootRef}>
      <Button
        ref={triggerRef}
        className="branch-selector__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {`Branch ${currentBranch}`}
      </Button>
      {open ? (
        <div className="branch-selector__panel" id={panelId}>
          <label className="branch-selector__label" htmlFor={`${panelId}-find`}>
            Find branch
          </label>
          <input
            id={`${panelId}-find`}
            ref={inputRef}
            className="branch-selector__input"
            type="text"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFailure(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              close();
            }}
          />
          <div className="branch-selector__list" role="listbox" aria-label="Branches">
            {matching.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                className="branch-selector__option"
                aria-selected={name === currentBranch}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  onSelect(name);
                }}
              >
                {name}
              </button>
            ))}
            {creatable ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="branch-selector__option branch-selector__option--create"
                disabled={pending}
                onClick={() => void create()}
              >
                {`Create branch: ${value}`}
              </button>
            ) : null}
          </div>
          {matching.length === 0 && !creatable && !invalid ? (
            <p className="branch-selector__empty">No matching branch</p>
          ) : null}
          {invalid ? (
            <p className="branch-selector__error" role="alert">
              {INVALID_BRANCH_MESSAGE}
            </p>
          ) : null}
          {failure ? (
            <p className="branch-selector__error" role="alert">
              {failure}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
