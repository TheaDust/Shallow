import { useEffect, useId, useRef, useState } from "react";

import { BRANCH_NAME_INVALID_MESSAGE, isValidBranchName } from "../lib/branch-name";

export interface BranchOption {
  name: string;
}

export interface BranchSelectorProps {
  /** The branch the current page reads; shown on the trigger button. */
  currentBranch: string;
  /** Every branch of the repository; the options are the exact names. */
  branches: readonly BranchOption[];
  /** Write, Maintain, Admin or organization Owner may create a branch. */
  canCreateBranch: boolean;
  onSelectBranch(name: string): void;
  /** Creates the branch and returns an error message, or null on success. */
  onCreateBranch(name: string): Promise<string | null>;
}

/**
 * Branch selector of the repository Code page: the unique button
 * "Branch <current branch name>" opens a textbox named "Find branch" and the
 * matching options, whose accessible names are the exact branch names. Typing
 * filters the options immediately — no Enter and no separate search action — a
 * valid unused name offers "Create branch: <name>", an unmatched query shows
 * "No matching branch" and an invalid name shows "Invalid branch". Escape closes
 * the selector without changing the current branch.
 */
export function BranchSelector({
  currentBranch,
  branches,
  canCreateBranch,
  onSelectBranch,
  onCreateBranch,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = `find-branch-${useId()}`;

  const close = () => {
    setOpen(false);
    setQuery("");
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const trimmed = query.trim();
  const invalid = trimmed !== "" && !isValidBranchName(trimmed);
  const matching = trimmed
    ? branches.filter((branch) => branch.name.toLowerCase().includes(trimmed.toLowerCase()))
    : [...branches];
  const isExisting = branches.some((branch) => branch.name === trimmed);
  const createName = !invalid && trimmed !== "" && !isExisting && canCreateBranch ? trimmed : "";
  const noMatch = !invalid && trimmed !== "" && matching.length === 0 && createName === "";

  const select = (name: string) => {
    close();
    onSelectBranch(name);
  };

  const create = async () => {
    if (busy || !createName) return;
    setBusy(true);
    setError(null);
    const message = await onCreateBranch(createName);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    close();
  };

  const optionClass = "branch-selector__option";

  return (
    <div className="branch-selector" ref={rootRef}>
      <button
        type="button"
        className="ui-button branch-selector__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            setQuery("");
            setError(null);
            setOpen(true);
          }
        }}
      >
        Branch {currentBranch}
      </button>
      {open ? (
        <div className="branch-selector__panel">
          <input
            id={inputId}
            className="branch-selector__input"
            type="text"
            name="find-branch"
            aria-label="Find branch"
            placeholder="Find branch"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
          />
          {matching.length > 0 || createName ? (
            <ul className="branch-selector__options" role="listbox" aria-label="Branches">
              {matching.map((branch) => (
                <li key={branch.name}>
                  <button
                    type="button"
                    role="option"
                    className={optionClass}
                    aria-selected={branch.name === currentBranch}
                    onClick={() => select(branch.name)}
                  >
                    {branch.name}
                  </button>
                </li>
              ))}
              {createName ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    className={optionClass}
                    aria-selected={false}
                    disabled={busy}
                    onClick={create}
                  >
                    {`Create branch: ${createName}`}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
          {invalid ? (
            <p className="branch-selector__message" role="alert">
              {BRANCH_NAME_INVALID_MESSAGE}
            </p>
          ) : null}
          {noMatch ? (
            <p className="branch-selector__message" role="status">
              No matching branch
            </p>
          ) : null}
          {error ? (
            <p className="branch-selector__message" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
