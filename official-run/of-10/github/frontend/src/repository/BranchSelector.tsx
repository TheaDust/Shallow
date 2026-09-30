import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { apiErrorMessage, readErrorFields } from "../lib/api";
import { isValidBranchName } from "../lib/branch-rules";
import { createRepositoryBranch } from "../lib/repository-edits-api";
import type { RepositoryBranch } from "../lib/repositories-api";

export interface BranchSelectorProps {
  owner: string;
  name: string;
  /** The branch the current page reads; the control reads "Branch <name>". */
  branch: string;
  branches: RepositoryBranch[];
  /** Address of the same view on another branch (the current path is kept). */
  branchHref(branch: string): string;
}

/**
 * Branch selector at the top of the Code page (REQ-4-3-1, REQ-4-3-2): a unique
 * button named `Branch <current branch name>` opens a textbox named `Find branch`
 * and the matching branch names as `option` items. Typing filters the options
 * immediately, without pressing Enter, and choosing one switches the branch of
 * the current page. Nothing is written by listing or switching branches.
 *
 * A signed-in viewer who types a valid unused name is offered one more option,
 * `Create branch: <name>`, whose base defaults to the current branch head and is
 * shown beside that head commit; an invalid name immediately reads `Invalid
 * branch`. The server stores the reference and refuses an unknown, duplicated or
 * unauthorised request, so the selector never decides on its own.
 */
export function BranchSelector({ owner, name, branch, branches, branchHref }: BranchSelectorProps) {
  const { account } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const listId = useId();
  const inputId = useId();

  const names = useMemo(
    () => (branches.length > 0 ? branches.map((candidate) => candidate.name) : [branch]),
    [branches, branch],
  );
  const typed = query.trim();
  const needle = typed.toLowerCase();
  const matching = names.filter((candidate) => candidate.toLowerCase().includes(needle));
  // A creation entry exists only for a signed-in viewer, so an anonymous visitor
  // keeps the plain branch list and its empty state.
  const duplicate = typed.length > 0 && names.includes(typed);
  const canCreate = account !== null && typed.length > 0 && !duplicate && isValidBranchName(typed);
  const invalidName = typed.length > 0 && !duplicate && !isValidBranchName(typed);
  const headCommitId =
    branches.find((candidate) => candidate.name === branch)?.headCommitId ?? null;
  const optionValues = [canCreate ? typed : null, ...matching].filter(
    (value): value is string => value !== null,
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
      setBusy(false);
      return;
    }
    inputRef.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectBranch = (name: string) => {
    setOpen(false);
    window.location.hash = branchHref(name);
  };

  const createBranch = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createRepositoryBranch(owner, name, { name: typed, baseBranch: branch });
      setOpen(false);
      window.location.hash = branchHref(typed);
    } catch (caught) {
      const fields = readErrorFields(caught);
      setError(fields.name ?? apiErrorMessage(caught, "The branch could not be created."));
    } finally {
      setBusy(false);
    }
  };

  const focusOption = (index: number) => {
    if (optionValues.length === 0) return;
    const normalized = ((index % optionValues.length) + optionValues.length) % optionValues.length;
    optionRefs.current[normalized]?.focus();
  };

  return (
    <div className="branch-selector" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="branch-selector__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          else if (event.key === "ArrowDown" && !open) setOpen(true);
        }}
      >
        Branch {branch}
      </button>
      {open ? (
        <div className="branch-selector__panel">
          <label className="branch-selector__label" htmlFor={inputId}>
            Find branch
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="branch-selector__input"
            type="text"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                focusOption(0);
              }
            }}
          />
          {canCreate ? (
            <p className="branch-selector__base">
              Base branch: {branch}
              {headCommitId ? ` (${headCommitId.slice(0, 7)})` : ""}
            </p>
          ) : null}
          {invalidName ? (
            <p className="branch-selector__invalid" role="alert">
              Invalid branch
            </p>
          ) : null}
          {error ? (
            <p className="branch-selector__error" role="alert">
              {error}
            </p>
          ) : null}
          {optionValues.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Branches" className="branch-selector__options">
              {optionValues.map((value, index) => {
                const creation = canCreate && value === typed;
                return (
                  <li
                    key={creation ? `create:${value}` : `branch:${value}`}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    role="option"
                    className="branch-selector__option"
                    aria-selected={!creation && value === branch}
                    aria-disabled={creation && busy ? true : undefined}
                    tabIndex={-1}
                    onClick={() => {
                      if (creation) {
                        if (!busy) void createBranch();
                        return;
                      }
                      selectBranch(value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (creation) {
                          if (!busy) void createBranch();
                        } else {
                          selectBranch(value);
                        }
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        focusOption(index + 1);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        focusOption(index - 1);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        close();
                      }
                    }}
                  >
                    {creation ? `Create branch: ${value}` : value}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {matching.length === 0 ? (
            <p className="branch-selector__empty">No matching branch</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
