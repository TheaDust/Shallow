import { useEffect, useId, useRef, useState } from "react";

export interface IssueMetadataOption {
  /** The stored value sent to the server (a username, label or milestone name). */
  value: string;
  /** The exact accessible name shown for the option. */
  name: string;
  /** Whether the issue already holds this relationship. */
  selected: boolean;
}

export interface IssueMetadataSelectProps {
  /** Accessible name of the trigger, e.g. `Assignees`, `Labels`, `Milestone`. */
  label: string;
  options: readonly IssueMetadataOption[];
  /** Adds a filter textbox with this accessible name when it is set. */
  searchLabel?: string;
  disabled?: boolean;
  /**
   * Saves (or removes) the relationship; resolving with a message keeps the
   * panel open and shows the message, resolving with null closes it.
   */
  onSelect(value: string, selected: boolean): Promise<string | null>;
}

/**
 * One issue-metadata selector (REQ-5-3). The unique `label` button opens a
 * panel whose options are the repository-scoped candidates; an option saves its
 * relationship immediately — there is no separate Save action — and the panel
 * closes on success. When `searchLabel` is set the panel also holds a textbox
 * that filters the options while the user types, and selecting an option the
 * issue already holds removes that relationship again.
 */
export function IssueMetadataSelect({
  label,
  options,
  searchLabel,
  disabled = false,
  onSelect,
}: IssueMetadataSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = `metadata-search-${useId()}`;

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

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? options.filter((option) => option.name.toLowerCase().includes(needle))
    : options;

  // Opening is idempotent: a repeated activation keeps the panel open instead of
  // undoing the first one. Escape or a click outside closes it.
  const openPanel = () => {
    setQuery("");
    setError(null);
    setOpen(true);
  };

  const choose = async (option: IssueMetadataOption) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await onSelect(option.value, option.selected);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    close();
  };

  return (
    <div className="issue-metadata" ref={rootRef}>
      <button
        type="button"
        className="ui-button ui-button--secondary issue-metadata__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={openPanel}
      >
        {label}
      </button>
      {open ? (
        <div className="issue-metadata__panel">
          {searchLabel ? (
            <>
              <label htmlFor={inputId}>{searchLabel}</label>
              <input
                id={inputId}
                className="issue-metadata__input"
                type="text"
                name="metadata-search"
                placeholder={searchLabel}
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError(null);
                }}
              />
            </>
          ) : null}
          <ul className="issue-metadata__options" role="listbox" aria-label={label}>
            {matching.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  className="issue-metadata__option"
                  aria-selected={option.selected}
                  disabled={busy}
                  onClick={() => void choose(option)}
                >
                  {option.name}
                </button>
              </li>
            ))}
          </ul>
          {error ? (
            <p className="issue-metadata__message" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
