import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import { branchNameError } from "./write-validation";

export interface RepositoryBranchSelectorProps {
  /** The branch the current page reads. */
  branch: string;
  /** Every branch of the repository, sorted by name. */
  branches: string[];
  /** Hash address of the same page on another branch. */
  hrefForBranch: (branch: string) => string;
  /**
   * Creates a new branch from the current branch head, then the caller
   * navigates to it. Absent for a viewer without Write permission.
   */
  createBranch?: (name: string) => Promise<void>;
}

/**
 * The branch selector at the top of the Code pages. It is a button named
 * `Branch <current branch name>` that opens a `Find branch` textbox and a list
 * of role option items named exactly after the stored branches. Typing filters
 * the options without any submit; Escape closes the popover and leaves the
 * current branch untouched. Switching only changes the snapshot the page reads,
 * so no branch, commit or file is ever modified by browsing.
 */
export function RepositoryBranchSelector({
  branch,
  branches,
  hrefForBranch,
  createBranch,
}: RepositoryBranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const names = useMemo(
    () => (branches.includes(branch) ? branches : [branch, ...branches]),
    [branch, branches],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setError(null);
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const trimmed = query.trim();
  const matches =
    trimmed.length === 0
      ? names
      : names.filter((name) => name.toLowerCase().includes(trimmed.toLowerCase()));
  const invalidReason = trimmed.length > 0 ? branchNameError(trimmed) : null;
  const duplicate = trimmed.length > 0 && names.includes(trimmed);
  const createName =
    trimmed.length > 0 && !invalidReason && !duplicate && createBranch ? trimmed : null;
  // The empty branch-search state describes that no stored branch matched; it
  // coexists with the creation entry offered for a valid unused name.
  const noMatch = trimmed.length > 0 && matches.length === 0 && !invalidReason;

  const options = [
    ...matches.map((name) => ({ kind: "branch" as const, name })),
    ...(createName ? [{ kind: "create" as const, name: createName }] : []),
  ];

  function selectBranch(name: string) {
    setOpen(false);
    window.location.hash = hrefForBranch(name);
  }

  async function selectCreate(name: string) {
    if (!createBranch) return;
    setBusy(true);
    setError(null);
    try {
      await createBranch(name);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The branch could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const optionLabel = (option: (typeof options)[number]) =>
    option.kind === "create" ? `Create branch: ${option.name}` : option.name;

  return (
    <div className="repository-branch-selector" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="repository-branch-selector__trigger"
        aria-label={`Branch ${branch}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {`Branch ${branch}`}
      </button>
      {open ? (
        <div className="repository-branch-selector__popover">
          <label className="repository-branch-selector__field">
            <span>Find branch</span>
            <input
              ref={inputRef}
              type="text"
              name="branch-search"
              aria-label="Find branch"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const option = options[activeIndex];
                  if (!option || busy) return;
                  if (option.kind === "create") void selectCreate(option.name);
                  else selectBranch(option.name);
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (options.length === 0) return;
                  setActiveIndex((index) => {
                    const next = index + (event.key === "ArrowDown" ? 1 : -1);
                    return (next + options.length) % options.length;
                  });
                }
              }}
            />
          </label>
          <p className="repository-branch-selector__base">{`Base: ${branch}`}</p>
          {invalidReason ? (
            <p className="repository-branch-selector__invalid" role="status">
              {invalidReason}
            </p>
          ) : null}
          {noMatch ? (
            <p className="repository-branch-selector__empty" role="status">
              No matching branch
            </p>
          ) : null}
          {error ? (
            <p className="repository-branch-selector__error" role="alert">
              {error}
            </p>
          ) : null}
          {options.length > 0 ? (
            <ul
              id={listboxId}
              className="repository-branch-selector__options"
              role="listbox"
              aria-label="Branches"
            >
              {options.map((option, index) => (
                <li
                  key={optionLabel(option)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.kind === "branch" && option.name === branch}
                  className="repository-branch-selector__option"
                  data-active={index === activeIndex || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    if (busy) return;
                    if (option.kind === "create") void selectCreate(option.name);
                    else selectBranch(option.name);
                  }}
                >
                  {optionLabel(option)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
