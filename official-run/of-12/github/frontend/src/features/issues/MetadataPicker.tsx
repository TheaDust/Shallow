import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { MutationOutcome } from "../../lib/api";
import { Button } from "../../ui";

/**
 * One settings selector of the issue sidebar (REQ-5-3).
 *
 * The area renders a settings icon exposed as a button named after the area
 * (“Assignees”, “Labels” or “Milestone”). Opening it lists every selectable
 * item as an `option` named exactly after the item — a member username, a label
 * name, a milestone name or `None` — and marks the current associations as
 * selected. Clicking an option stores the change immediately and closes the
 * selector, so there is never a separate save action and no confirmation. A
 * refused change keeps the selector open and reports the reason next to it.
 *
 * The assignee selector additionally searched as the user types: the option
 * list follows the textbox without Enter and without a separate search button,
 * so the caller never has to submit a query before choosing.
 */
export interface MetadataPickerOption {
  /** The stored value the option sends back. */
  value: string;
  /** The exact accessible name of the option. */
  name: string;
  /** True when the item is associated with the issue right now. */
  selected: boolean;
}

export interface MetadataPickerProps {
  /** Accessible name of the settings button and of the option list. */
  label: string;
  /** When present, the selector offers a live search textbox with this name. */
  searchLabel?: string;
  options: readonly MetadataPickerOption[];
  /** Stores the choice; the selector closes only when this succeeds. */
  onSelect(value: string): Promise<MutationOutcome<unknown>>;
}

export function MetadataPicker({ label, searchLabel, options, onSelect }: MetadataPickerProps) {
  const generatedId = useId();
  const listId = `${generatedId}-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? options.filter((option) => option.name.toLowerCase().includes(needle))
    : options;

  const choose = async (value: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await onSelect(value);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setQuery("");
    setOpen(false);
  };

  const onToggle = () => {
    setError(null);
    if (open) {
      setQuery("");
      setOpen(false);
      return;
    }
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setQuery("");
      setOpen(false);
    }
  };

  return (
    <div className="issue-meta__picker" ref={rootRef} onKeyDown={onKeyDown}>
      <Button
        variant="ghost"
        className="issue-meta__settings"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={saving}
        onClick={onToggle}
      >
        <span aria-hidden="true">⚙</span>
      </Button>
      {open ? (
        <div className="issue-meta__menu">
          {searchLabel ? (
            <input
              className="issue-meta__search"
              type="text"
              aria-label={searchLabel}
              value={query}
              autoComplete="off"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          <div className="issue-meta__options" role="listbox" aria-label={label} id={listId}>
            {visible.length === 0 ? (
              <p className="issue-meta__empty">No matching items</p>
            ) : (
              visible.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.selected}
                  className="issue-meta__option"
                  disabled={saving}
                  onClick={() => void choose(option.value)}
                >
                  <span className="issue-meta__check" aria-hidden="true">
                    {option.selected ? "✓" : ""}
                  </span>
                  {option.name}
                </button>
              ))
            )}
          </div>
          {error ? (
            <p className="issue-meta__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
