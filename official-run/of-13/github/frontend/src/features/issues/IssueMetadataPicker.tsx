import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "../../ui/Button";

/** One selectable record of a metadata picker. */
export interface IssueMetadataOption {
  /** Stable identity: a username, a label name or a milestone title. */
  id: string;
  /** The exact accessible name of the option. */
  label: string;
  /** True when the issue already holds this association. */
  selected: boolean;
}

export interface IssueMetadataPickerProps {
  /** The accessible name of the settings button: `Assignees`, `Labels` or `Milestone`. */
  triggerLabel: string;
  options: readonly IssueMetadataOption[];
  /**
   * When set, the selector also offers this textbox and narrows the matching
   * options while the user types, without Enter or a separate search button.
   */
  searchLabel?: string;
  multiSelect?: boolean;
  /** True while a save is in flight, so no option can be activated twice. */
  busy?: boolean;
  emptyLabel?: string;
  onSelect(option: IssueMetadataOption): void;
}

/**
 * The settings icon of one metadata area and the selector it opens. Clicking an
 * option immediately hands the association to the caller and closes the
 * selector; the caller answers with the persisted record, so there is no
 * separate save action.
 */
export function IssueMetadataPicker({
  triggerLabel,
  options,
  searchLabel,
  multiSelect = false,
  busy = false,
  emptyLabel = "No options available",
  onSelect,
}: IssueMetadataPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const term = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      options.filter(
        (option) => term.length === 0 || option.label.toLowerCase().includes(term),
      ),
    [options, term],
  );

  return (
    <div className="issue-metadata-picker" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          // Reopening always starts from the complete list, so a member that is
          // now selected is visible without typing the search term again.
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true" className="issue-metadata-picker__icon">
          ⚙
        </span>
      </Button>
      {open ? (
        <div
          className="issue-metadata-picker__panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          {searchLabel ? (
            <input
              type="text"
              className="issue-metadata-picker__search"
              aria-label={searchLabel}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <div
            id={listId}
            role="listbox"
            aria-label={triggerLabel}
            aria-multiselectable={multiSelect ? true : undefined}
            className="issue-metadata-picker__list"
          >
            {visible.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.selected}
                disabled={busy}
                className="issue-metadata-picker__option"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  onSelect(option);
                }}
              >
                <span aria-hidden="true" className="issue-metadata-picker__check">
                  {option.selected ? "✓" : ""}
                </span>
                {option.label}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="issue-metadata-picker__empty" role="status">
              {emptyLabel}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
