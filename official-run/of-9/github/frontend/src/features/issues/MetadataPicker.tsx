import { useEffect, useId, useRef, useState } from "react";

export interface MetadataPickerOption {
  id: string;
  name: string;
  selected: boolean;
}

// Sidebar picker used by the Assignees, Labels and Milestone areas of the
// issue detail page. The trigger is a button named after the section; opening
// it shows repository-scoped options (role=option) whose accessible name is
// the exact option name. Clicking an option immediately saves the change and
// closes the picker; there is no separate Save action.
export function MetadataPicker({
  label,
  options,
  searchable = false,
  searchLabel,
  onSelect,
}: {
  label: string;
  options: readonly MetadataPickerOption[];
  searchable?: boolean;
  searchLabel?: string;
  onSelect(optionId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    if (searchable) searchRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open, searchable]);

  const queryLower = query.trim().toLowerCase();
  const visible = options.filter(
    (option) => !queryLower || option.name.toLowerCase().includes(queryLower),
  );

  const select = (option: MetadataPickerOption) => {
    setOpen(false);
    setQuery("");
    onSelect(option.id);
  };

  return (
    <div className="metadata-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="metadata-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true" className="metadata-picker__gear">
          ⚙
        </span>
        {label}
      </button>
      {open ? (
        <div className="metadata-picker__popover">
          {searchable ? (
            <input
              ref={searchRef}
              type="search"
              aria-label={searchLabel ?? label}
              placeholder={searchLabel ?? label}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="metadata-picker__search"
            />
          ) : null}
          <div id={listboxId} role="listbox" aria-label={label} className="metadata-picker__list">
            {visible.length === 0 ? (
              <p className="metadata-picker__empty">No results</p>
            ) : (
              visible.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.selected}
                  className="metadata-picker__option"
                  onClick={() => select(option)}
                >
                  <span aria-hidden="true" className="metadata-picker__check">
                    {option.selected ? "✓" : ""}
                  </span>
                  <span className="metadata-picker__name">{option.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
