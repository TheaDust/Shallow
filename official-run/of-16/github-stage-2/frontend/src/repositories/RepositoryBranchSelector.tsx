import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "../ui";
import { isValidBranchName } from "./branchName";

export interface RepositoryBranchSelectorProps {
  /** Branch whose snapshot the current page browses. */
  branch: string;
  /** Every branch name available to the current repository. */
  branches: readonly string[];
  /** Whether the viewer may create a branch (Write, Maintain, Admin or Owner). */
  canCreate: boolean;
  /** True while a creation request is in flight. */
  busy?: boolean;
  /** Server rejection of a creation attempt, shown inside the selector. */
  createError?: string | null;
  onSelectBranch(branch: string): void;
  onCreateBranch(name: string): void;
}

interface BranchOption {
  kind: "existing" | "create";
  value: string;
  label: string;
  selected: boolean;
}

/**
 * Branch selector of the repository Code page. The control is one button whose
 * accessible name is exactly `Branch <current branch name>`; it opens a "Find
 * branch" textbox and the selectable branch options. Typing filters the options
 * (and offers `Create branch: <name>` for a valid unused name when the viewer may
 * write), an unmatched query shows the "No matching branch" state, a malformed
 * name shows "Invalid branch", and Escape closes the selector without changing
 * the active branch. Switching branches only changes the browsing snapshot.
 */
export function RepositoryBranchSelector({
  branch,
  branches,
  canCreate,
  busy = false,
  createError = null,
  onSelectBranch,
  onCreateBranch,
}: RepositoryBranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const popupId = useId();
  const inputId = useId();

  // The active branch changed (or the page loaded another repository): the
  // selector returns to its closed state with an empty query.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [branch, branches.join("\u0000")]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const name = query.trim();
  const invalid = name.length > 0 && !isValidBranchName(name);
  const needle = name.toLowerCase();
  const matches = branches.filter((candidate) => (
    needle.length === 0 || candidate.toLowerCase().includes(needle)
  ));
  const canCreateNow = canCreate && name.length > 0 && !invalid && !branches.includes(name);
  const options: BranchOption[] = [
    ...matches.map((candidate) => ({
      kind: "existing" as const,
      value: candidate,
      label: candidate,
      selected: candidate === branch,
    })),
    ...(canCreateNow
      ? [{ kind: "create" as const, value: name, label: `Create branch: ${name}`, selected: false }]
      : []),
  ];
  const noMatch = !invalid && name.length > 0 && options.length === 0;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (option: BranchOption) => {
    if (option.kind === "existing") {
      close();
      onSelectBranch(option.value);
      return;
    }
    // Creating a branch keeps the selector open: a server rejection stays
    // visible next to the option, while a success switches the page away.
    onCreateBranch(option.value);
  };

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const normalized = (index + options.length) % options.length;
    optionRefs.current[normalized]?.focus();
  };

  const activeOptionIndex = () => options.findIndex((_, index) => (
    optionRefs.current[index] === document.activeElement
  ));

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const current = activeOptionIndex();
    if (current === -1) focusOption(delta === 1 ? 0 : options.length - 1);
    else focusOption(current + delta);
  };

  return (
    <div className="branch-selector" ref={rootRef}>
      <Button
        variant="secondary"
        className="branch-selector__trigger"
        ref={triggerRef}
        aria-label={`Branch ${branch}`}
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
      >
        <span className="branch-selector__trigger-text">
          {`Branch ${branch}`}
          <span className="branch-selector__caret" aria-hidden="true">▾</span>
        </span>
      </Button>
      {open ? (
        <div id={popupId} className="branch-selector__popup" onKeyDown={handleKeyDown}>
          <div className="branch-selector__field">
            <label className="branch-selector__label" htmlFor={inputId}>
              Find branch
            </label>
            <input
              id={inputId}
              ref={inputRef}
              className="branch-selector__input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {invalid ? (
            <p className="branch-selector__message" role="alert">
              Invalid branch
            </p>
          ) : null}
          {options.length > 0 ? (
            <ul className="branch-selector__options" role="listbox" aria-label="Branches">
              {options.map((option, index) => (
                <li
                  key={`${option.kind}:${option.value}`}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  className="branch-selector__option"
                  data-kind={option.kind}
                  role="option"
                  aria-selected={option.selected}
                  aria-busy={option.kind === "create" && busy ? true : undefined}
                  tabIndex={-1}
                  onClick={() => choose(option)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(option);
                    }
                  }}
                >
                  {option.label}
                </li>
              ))}
            </ul>
          ) : null}
          {noMatch ? (
            <p className="branch-selector__message" role="status">
              No matching branch
            </p>
          ) : null}
          {createError ? (
            <p className="branch-selector__message" role="alert">
              {createError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
