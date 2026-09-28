import { useEffect, useRef, useState } from "react";

import { RepoBranch } from "../../lib/repo-api";

interface BranchSelectorProps {
  branches: RepoBranch[];
  currentBranch: string;
  canCreate: boolean;
  onSelect: (name: string) => void;
  onCreate: (name: string) => Promise<string | null>;
}

type SelectorItem = { kind: "branch"; name: string } | { kind: "create"; name: string };

/**
 * Branch-name rules (REQ-4-3): 1–255 characters of ASCII letters, digits,
 * `-`, `_`, `.`, `/`; no trailing `/` or `.`; no consecutive `..` or `//`.
 */
export function isValidBranchName(value: string): boolean {
  if (!value) return false;
  if (value.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.endsWith("/") || value.endsWith(".")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return true;
}

/**
 * The branch selector at the top of the Code page and file pages. The unique
 * button is named “Branch <current branch name>”; activating it opens a
 * textbox named “Find branch” and a listbox whose options carry the branch
 * names (the current branch is marked). Typing filters the options live; an
 * unmatched search shows “No matching branch”. A signed-in writer typing a
 * valid unused name gets the “Create branch: <name>” option; an invalid name
 * shows “Invalid branch” immediately. Escape closes the selector without
 * changing the active branch.
 */
export function BranchSelector({ branches, currentBranch, canCreate, onSelect, onCreate }: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
        setError(null);
        setCreating(false);
        buttonRef.current?.focus();
      }
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setError(null);
      setFocusedIndex(Math.max(0, branches.findIndex((branch) => branch.name === currentBranch)));
    }
  }, [open, branches, currentBranch]);

  if (branches.length === 0) return null;

  const value = query.trim();
  const matches = value
    ? branches.filter((branch) => branch.name.toLowerCase().includes(value.toLowerCase()))
    : branches;
  const nameExists = branches.some((branch) => branch.name === value);
  const validUnused = value !== "" && !nameExists && matches.length === 0 && isValidBranchName(value);
  const invalidName = value !== "" && !isValidBranchName(value);
  const items: SelectorItem[] = matches.map((branch) => ({ kind: "branch", name: branch.name }));
  if (validUnused && canCreate) {
    items.push({ kind: "create", name: `Create branch: ${value}` });
  }

  function choose(name: string) {
    setOpen(false);
    setQuery("");
    if (name !== currentBranch) onSelect(name);
  }

  async function chooseCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const message = await onCreate(value);
    if (message) {
      setError(message);
      setCreating(false);
    } else {
      setOpen(false);
      setQuery("");
      setCreating(false);
    }
    // On success the parent navigates to the new branch; closing the
    // selector keeps the next open state consistent with the new branch.
  }

  function selectFocused() {
    const item = items[focusedIndex];
    if (!item) return;
    if (item.kind === "branch") choose(item.name);
    else void chooseCreate();
  }

  function handleListKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectFocused();
    }
  }

  return (
    <div className="branch-selector">
      <button
        ref={buttonRef}
        type="button"
        className="branch-selector__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Branch {currentBranch}
      </button>
      {open && (
        <div className="branch-selector__panel">
          <div className="branch-selector__find">
            <label className="visually-hidden" htmlFor="find-branch">
              Find branch
            </label>
            <input
              ref={inputRef}
              id="find-branch"
              type="text"
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setFocusedIndex(0);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setFocusedIndex((index) => Math.min(index + 1, items.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setFocusedIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  selectFocused();
                }
              }}
            />
          </div>
          {error && (
            <p role="alert" className="branch-selector__error">
              {error}
            </p>
          )}
          {items.length > 0 ? (
            <ul
              className="branch-selector__list"
              role="listbox"
              aria-label="Branches"
              onKeyDown={handleListKeyDown}
            >
              {items.map((item, index) => (
                <li
                  key={item.name}
                  role="option"
                  aria-selected={item.kind === "branch" && item.name === currentBranch}
                  tabIndex={index === focusedIndex ? 0 : -1}
                  className={
                    "branch-selector__option" +
                    (item.kind === "branch" && item.name === currentBranch
                      ? " branch-selector__option--current"
                      : "") +
                    (item.kind === "create" ? " branch-selector__option--create" : "") +
                    (item.kind === "create" && creating ? " branch-selector__option--disabled" : "")
                  }
                  onClick={() => {
                    if (item.kind === "branch") choose(item.name);
                    else void chooseCreate();
                  }}
                  onMouseEnter={() => setFocusedIndex(index)}
                >
                  {item.name}
                  {item.kind === "create" && (
                    <span aria-hidden="true" className="branch-selector__base">
                      from {currentBranch}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="branch-selector__empty">
              {invalidName ? "Invalid branch" : "No matching branch"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
