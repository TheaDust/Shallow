import { useEffect, useId, useRef, useState } from "react";

import { branchNameError, type BranchCreationResult } from "./branch-actions";
import type { RepositoryBranch } from "./repository-api";

export type { BranchCreationResult };

export interface BranchSelectorProps {
  /** The branch every Code page of the repository reads right now. */
  branch: string;
  branches: readonly RepositoryBranch[];
  /** Switches the current branch; the page keeps its path where possible. */
  onSelect(branch: string): void;
  /** True when the viewer may create a branch from the current one (REQ-4-3-2). */
  canCreate?: boolean;
  /** Creates a new branch at the current branch head, then switches to it. */
  onCreate?(name: string): Promise<BranchCreationResult>;
}

/**
 * Branch selector of the Code page family (REQ-4-3-1, REQ-4-3-2).
 *
 * A single button spells the current branch as "Branch <current branch name>".
 * It opens a textbox named "Find branch" whose matching options carry the
 * branch names as their accessible names; typing narrows the list right away,
 * without an Enter press or a separate search button, and Escape closes the
 * selector. The selection only changes the branch the page reads — it is not a
 * stored user setting.
 *
 * A user with Write permission or higher additionally gets the creation entry
 * for the typed name: a valid unused name offers the option "Create branch:
 * <name>" that creates the branch at the displayed base (the current branch
 * head) and switches to it, a name already taken stays a selectable branch, and
 * an invalid name immediately displays "Invalid branch".
 */
export function BranchSelector({ branch, branches, onSelect, canCreate = false, onCreate }: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    inputRef.current?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const typed = query.trim();
  const needle = typed.toLowerCase();
  const matching = needle
    ? branches.filter((candidate) => candidate.name.toLowerCase().includes(needle))
    : branches;

  const nameError = typed ? branchNameError(typed) : null;
  const nameTaken = branches.some((candidate) => candidate.name === typed);
  const offeringCreation = canCreate && Boolean(onCreate) && typed !== "" && !nameError && !nameTaken;

  const close = () => {
    setOpen(false);
    setQuery("");
    setError(null);
    setCreating(false);
  };

  const select = (name: string) => {
    close();
    triggerRef.current?.focus();
    onSelect(name);
  };

  const create = async () => {
    if (!onCreate || creating) return;
    setCreating(true);
    setError(null);
    const result = await onCreate(typed);
    if (!result.ok) {
      setCreating(false);
      setError(result.error ?? "The branch could not be created.");
      return;
    }
    select(typed);
  };

  return (
    <div className="branch-selector" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="branch-selector__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setQuery("");
          setError(null);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
      >
        {`Branch ${branch}`}
      </button>
      {open ? (
        <div className="branch-selector__popover">
          <label className="branch-selector__search" htmlFor={`${listId}-input`}>
            <span>Find branch</span>
            <input
              id={`${listId}-input`}
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                  triggerRef.current?.focus();
                }
              }}
            />
          </label>
          {canCreate ? (
            <p className="branch-selector__base">
              {"Base "}
              <span className="branch-selector__base-name">{branch}</span>
            </p>
          ) : null}
          <ul className="branch-selector__options" id={listId} role="listbox" aria-label="Branches">
            {matching.map((candidate) => (
              <li
                key={candidate.name}
                role="option"
                aria-selected={candidate.name === branch}
                tabIndex={-1}
                className="branch-selector__option"
                onClick={() => select(candidate.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(candidate.name);
                  }
                }}
              >
                {candidate.name}
              </li>
            ))}
            {offeringCreation ? (
              <li
                role="option"
                aria-selected={false}
                aria-disabled={creating || undefined}
                tabIndex={-1}
                className="branch-selector__option branch-selector__option--create"
                onClick={() => {
                  void create();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void create();
                  }
                }}
              >
                {`Create branch: ${typed}`}
              </li>
            ) : null}
          </ul>
          {nameError ? (
            <p className="branch-selector__invalid" role="status">
              {nameError}
            </p>
          ) : null}
          {matching.length === 0 ? <p className="branch-selector__empty">No matching branch</p> : null}
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
