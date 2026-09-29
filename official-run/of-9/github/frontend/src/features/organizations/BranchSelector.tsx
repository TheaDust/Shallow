import { useEffect, useRef, useState } from "react";

import { useHashLocation, navigate } from "../../lib/hash-route";
import { createRepositoryBranch, getRepositoryBranches } from "./api";

// Branch-name rule: 1-255 chars, ASCII letters/digits and `- _ . /`, must not
// end with `/` or `.` and must not contain consecutive `..` or `//`.
function isValidBranchName(name: string): boolean {
  if (name.length < 1 || name.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  if (name.includes("..") || name.includes("//")) return false;
  return true;
}

interface SelectorOption {
  key: string;
  label: string;
  kind: "branch" | "create";
}

export function BranchSelector({
  owner,
  name,
  currentBranch,
  canCreate,
}: {
  owner: string;
  name: string;
  currentBranch: string;
  canCreate: boolean;
}) {
  const location = useHashLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBranches(null);
    setLoadError(false);
    setError(null);
    setQuery("");
    getRepositoryBranches(owner, name)
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    const focus = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(focus);
    };
  }, [open, owner, name]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const trimmed = query.trim();
  const list = branches ?? [];
  const matches = list.filter((branch) => branch.toLowerCase().includes(trimmed.toLowerCase()));
  const nameValid = isValidBranchName(trimmed);
  const exists = list.includes(trimmed);
  const canCreateOption =
    canCreate && trimmed.length > 0 && nameValid && !exists;
  const showInvalid = trimmed.length > 0 && !nameValid;
  const options: SelectorOption[] = [
    ...matches.map((branch) => ({ key: `branch:${branch}`, label: branch, kind: "branch" as const })),
    ...(canCreateOption
      ? [{ key: `create:${trimmed}`, label: `Create branch: ${trimmed}`, kind: "create" as const }]
      : []),
  ];

  const switchTo = (branch: string) => {
    const params = new URLSearchParams(location.search);
    params.set("branch", branch);
    navigate(location.path, params);
    close();
  };

  const createBranch = async () => {
    if (creating || !canCreateOption) return;
    setCreating(true);
    setError(null);
    const result = await createRepositoryBranch(owner, name, {
      name: trimmed,
      base: currentBranch,
    });
    if (result.ok) {
      setCreating(false);
      switchTo(result.branch.name);
      return;
    }
    setCreating(false);
    setError(
      result.errors.name ?? result.errors.general ?? result.errors.base ?? "Unable to create branch",
    );
  };

  const activate = (option: SelectorOption) => {
    if (option.kind === "branch") switchTo(option.label);
    else void createBranch();
  };

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const normalized = ((index % options.length) + options.length) % options.length;
    optionRefs.current[normalized]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const current = optionRefs.current.findIndex((node) => node === document.activeElement);
      focusOption(current === -1 ? 0 : current + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (options.length > 0) activate(options[0]);
    }
  };

  const emptyText = showInvalid
    ? "Invalid branch"
    : options.length === 0 && trimmed.length > 0
      ? "No matching branch"
      : null;

  return (
    <div className="branch-selector" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-button ui-button--secondary branch-selector__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Branch {currentBranch}
      </button>
      {open ? (
        <div className="branch-selector__popover" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            type="text"
            aria-label="Find branch"
            placeholder="Find branch"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
          />
          {loadError ? (
            <p role="alert" className="branch-selector__error">
              Unable to load branches
            </p>
          ) : branches === null ? (
            <p role="status" className="branch-selector__status">
              Loading branches…
            </p>
          ) : (
            <>
              {canCreateOption ? (
                <p className="branch-selector__base">Base: {currentBranch}</p>
              ) : null}
              {emptyText ? (
                <p className="branch-selector__empty">{emptyText}</p>
              ) : (
                <ul role="listbox" aria-label="Branches" className="branch-selector__list">
                  {options.map((option, index) => (
                    <li
                      key={option.key}
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      role="option"
                      aria-selected={option.kind === "branch" && option.label === currentBranch}
                      aria-disabled={option.kind === "create" && creating}
                      tabIndex={-1}
                      className="branch-selector__option"
                      onClick={() => activate(option)}
                    >
                      {option.kind === "branch" && option.label === currentBranch ? (
                        <span aria-hidden="true" className="branch-selector__check">
                          ✓
                        </span>
                      ) : null}
                      {option.label}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error ? (
            <p role="alert" className="branch-selector__error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
